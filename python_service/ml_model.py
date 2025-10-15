"""
Inference module: fetches latest market data, engineers features,
and runs multi-horizon prediction through pre-trained model artifacts.

Each horizon (1h, 6h, 24h) has its own trained pipeline.
The model predicts log_return. Price is reconstructed via:
    predicted_price = current_price * exp(predicted_log_return)

No training happens here. Run training/train_model.py to train.
"""

import asyncio

import numpy as np
import pandas as pd
import httpx
from cachetools import TTLCache

from model_manager import manager

SYMBOL_TO_COINGECKO = {
    "BTC": "bitcoin",
    "ETH": "ethereum",
    "SOL": "solana",
    "BNB": "binancecoin",
    "XRP": "ripple",
    "ADA": "cardano",
    "DOGE": "dogecoin",
    "DOT": "polkadot",
    "AVAX": "avalanche-2",
    "LINK": "chainlink",
    "THETA": "theta-token",
    "TDROP": "thetadrop",
}

_market_cache: TTLCache = TTLCache(maxsize=32, ttl=300)


async def _fetch_recent_data(coin_id: str, days: int = 7) -> pd.DataFrame:
    """Fetch recent data for feature engineering (inference only)."""
    cache_key = f"inf_{coin_id}_{days}"
    if cache_key in _market_cache:
        return _market_cache[cache_key].copy()

    url = f"https://api.coingecko.com/api/v3/coins/{coin_id}/market_chart"
    async with httpx.AsyncClient(timeout=15) as client:
        for attempt in range(3):
            resp = await client.get(url, params={"vs_currency": "usd", "days": days})
            if resp.status_code == 429:
                await asyncio.sleep(10 * (attempt + 1))
                continue
            resp.raise_for_status()
            break
        else:
            resp.raise_for_status()

    data = resp.json()
    df = pd.DataFrame(data["prices"], columns=["timestamp", "price"])
    df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms")
    df = df.set_index("timestamp").sort_index()

    if "total_volumes" in data:
        vol_df = pd.DataFrame(data["total_volumes"], columns=["timestamp", "volume"])
        vol_df["timestamp"] = pd.to_datetime(vol_df["timestamp"], unit="ms")
        vol_df = vol_df.set_index("timestamp").sort_index()
        df = df.join(vol_df, how="left")

    _market_cache[cache_key] = df
    return df.copy()


def _engineer_latest_features(df: pd.DataFrame, symbol_id: int) -> tuple[np.ndarray, float, float]:
    """
    Engineer features from recent data — returns-based only, no raw prices as features.
    Returns (feature_vector, current_price, market_volatility_7d).
    """
    df = df.copy()

    # Log returns
    df["log_return"] = np.log(df["price"] / df["price"].shift(1))

    # Smoothed return signals
    df["log_return_ma7"] = df["log_return"].rolling(7).mean()
    df["log_return_ma14"] = df["log_return"].rolling(14).mean()

    # Volatility
    df["volatility_7"] = df["log_return"].rolling(7).std()
    df["volatility_14"] = df["log_return"].rolling(14).std()

    # Momentum (ratios — scale invariant)
    df["momentum_7"] = df["price"] / df["price"].shift(7) - 1
    df["momentum_14"] = df["price"] / df["price"].shift(14) - 1

    # Price/MA ratios (scale invariant)
    ma7 = df["price"].rolling(7).mean()
    ma30 = df["price"].rolling(30).mean()
    df["price_ma7_ratio"] = df["price"] / ma7
    df["price_ma30_ratio"] = df["price"] / ma30

    # Volume change ratio
    if "volume" in df.columns:
        vol_ma7 = df["volume"].rolling(7).mean()
        df["volume_change"] = df["volume"] / vol_ma7
    else:
        df["volume_change"] = 1.0

    df["symbol_id"] = symbol_id
    df = df.dropna()

    feature_cols = [
        "log_return",
        "log_return_ma7",
        "log_return_ma14",
        "volatility_7",
        "volatility_14",
        "momentum_7",
        "momentum_14",
        "price_ma7_ratio",
        "price_ma30_ratio",
        "volume_change",
        "symbol_id",
    ]

    market_vol = float(df["volatility_7"].iloc[-1])
    return df[feature_cols].iloc[-1].values, float(df["price"].iloc[-1]), market_vol


async def predict_price(symbol: str):
    """Multi-horizon price prediction for a given crypto symbol."""
    symbol = symbol.upper()
    coin_id = SYMBOL_TO_COINGECKO.get(symbol)
    if not coin_id:
        return {"error": f"Unknown symbol: {symbol}. Supported: {list(SYMBOL_TO_COINGECKO.keys())}"}

    if not manager.is_loaded:
        return {
            "error": "No trained model available. Run: python training/train_model.py",
        }

    symbol_id_map = manager.symbol_to_id
    if symbol not in symbol_id_map:
        return {"error": f"Symbol {symbol} was not included in model training."}
    sym_id = symbol_id_map[symbol]

    df = await _fetch_recent_data(coin_id, days=7)
    if len(df) < 35:
        return {"error": "Insufficient recent data for feature engineering"}

    features, current_price, market_vol = _engineer_latest_features(df, sym_id)

    # Multi-horizon inference with market volatility for interval adjustment
    horizon_predictions = manager.predict_multi_horizon(
        features, current_price, market_volatility=market_vol
    )

    # Primary prediction (1h) for trend classification
    primary = horizon_predictions.get("1h", {})
    primary_change = primary.get("predicted_return_pct", 0)
    if primary_change > 0.5:
        trend = "bullish"
    elif primary_change < -0.5:
        trend = "bearish"
    else:
        trend = "neutral"

    model_info = manager.get_info()

    return {
        "symbol": symbol,
        "current_price": round(current_price, 2),
        "predictions": horizon_predictions,
        "trend": trend,
        "model": {
            "name": "RandomForestRegressor",
            "version": model_info.get("version"),
            "target": "multi-horizon log_return",
            "horizons": model_info.get("horizons", []),
            "trained_at": model_info.get("trained_at"),
        },
        "features_used": len(manager.features),
    }
