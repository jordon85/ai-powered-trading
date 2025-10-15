"""
Offline training pipeline for CryptoSkope price prediction.

Trains multi-horizon models predicting LOG RETURNS at:
  - 1h  (1-step ahead)
  - 6h  (6-step ahead)
  - 24h (24-step ahead)

Architecture:
    features at time t → predict log_return over [t, t+h]
    predicted_price = current_price * exp(predicted_log_return)

Usage:
    python training/train_model.py
    python training/train_model.py --days 180
"""

import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import TimeSeriesSplit, cross_val_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

SYMBOL_TO_ID = {
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

FEATURE_COLS = [
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

# Horizons: name → number of hourly steps ahead
HORIZONS = {
    "1h": 1,
    "6h": 6,
    "24h": 24,
}

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"


def fetch_market_data(coin_id: str, days: int = 90) -> pd.DataFrame:
    """Fetch price + volume data from CoinGecko with retry on rate limit."""
    url = f"https://api.coingecko.com/api/v3/coins/{coin_id}/market_chart"
    for attempt in range(3):
        resp = httpx.get(url, params={"vs_currency": "usd", "days": days}, timeout=20)
        if resp.status_code == 429:
            wait = 30 * (attempt + 1)
            print(f"    Rate limited, waiting {wait}s (attempt {attempt + 1}/3)...")
            time.sleep(wait)
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

    return df


def engineer_features(df: pd.DataFrame, symbol_id: int) -> pd.DataFrame:
    """Create return-based features and multi-horizon targets."""
    df = df.copy()

    # Log returns
    df["log_return"] = np.log(df["price"] / df["price"].shift(1))

    # Smoothed return signals
    df["log_return_ma7"] = df["log_return"].rolling(7).mean()
    df["log_return_ma14"] = df["log_return"].rolling(14).mean()

    # Volatility
    df["volatility_7"] = df["log_return"].rolling(7).std()
    df["volatility_14"] = df["log_return"].rolling(14).std()

    # Momentum (ratios)
    df["momentum_7"] = df["price"] / df["price"].shift(7) - 1
    df["momentum_14"] = df["price"] / df["price"].shift(14) - 1

    # Price/MA ratios
    ma7 = df["price"].rolling(7).mean()
    ma30 = df["price"].rolling(30).mean()
    df["price_ma7_ratio"] = df["price"] / ma7
    df["price_ma30_ratio"] = df["price"] / ma30

    # Volume change
    if "volume" in df.columns:
        vol_ma7 = df["volume"].rolling(7).mean()
        df["volume_change"] = df["volume"] / vol_ma7
    else:
        df["volume_change"] = 1.0

    df["symbol_id"] = symbol_id

    # Multi-horizon targets: cumulative log return over h steps
    for name, steps in HORIZONS.items():
        df[f"target_{name}"] = np.log(df["price"].shift(-steps) / df["price"])

    df = df.dropna()
    return df


def build_dataset(days: int = 90) -> pd.DataFrame:
    """Fetch and combine data for all symbols."""
    all_dfs = []
    symbols = list(SYMBOL_TO_ID.items())

    for idx, (symbol, coin_id) in enumerate(symbols):
        print(f"  Fetching {symbol} ({coin_id})...")
        try:
            raw = fetch_market_data(coin_id, days=days)
            featured = engineer_features(raw, symbol_id=idx)
            featured["symbol"] = symbol
            all_dfs.append(featured)
            print(f"    {len(featured)} samples after feature engineering")
            time.sleep(6)
        except Exception as e:
            print(f"    FAILED: {e}")
            continue

    if not all_dfs:
        raise RuntimeError("No data fetched for any symbol")

    combined = pd.concat(all_dfs, axis=0)
    combined = combined.sort_index()
    return combined


def train(days: int = 90):
    """Main training pipeline — trains one model per horizon."""
    print(f"\n{'='*60}")
    print(f"CryptoSkope Multi-Horizon Training Pipeline")
    print(f"{'='*60}")
    print(f"Date: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    print(f"Data window: {days} days")
    print(f"Horizons: {list(HORIZONS.keys())}")
    print(f"Symbols: {list(SYMBOL_TO_ID.keys())}")
    print()

    # 1. Build dataset
    print("[1/4] Fetching market data...")
    df = build_dataset(days=days)
    print(f"  Total samples: {len(df)}")
    print()

    # 2. Prepare features
    print("[2/4] Preparing features...")
    X = df[FEATURE_COLS].values
    print(f"  Features: {FEATURE_COLS}")
    print(f"  X shape: {X.shape}")
    print()

    # 3. Train one model per horizon
    print("[3/4] Training models...")
    tscv = TimeSeriesSplit(n_splits=5)
    pipelines = {}
    horizon_metrics = {}

    for horizon_name, steps in HORIZONS.items():
        target_col = f"target_{horizon_name}"
        y = df[target_col].values

        print(f"\n  --- {horizon_name} (shift={steps}) ---")
        print(f"  Target stats: mean={np.mean(y):.6f}, std={np.std(y):.6f}")

        pipeline = Pipeline([
            ("scaler", StandardScaler()),
            ("model", RandomForestRegressor(
                n_estimators=200,
                max_depth=15,
                min_samples_leaf=5,
                random_state=42,
                n_jobs=-1,
            )),
        ])

        cv_r2 = cross_val_score(pipeline, X, y, cv=tscv, scoring="r2")
        cv_mae = cross_val_score(pipeline, X, y, cv=tscv, scoring="neg_mean_absolute_error")
        mean_r2 = float(np.mean(cv_r2))
        mean_mae = float(-np.mean(cv_mae))

        print(f"  CV R²: {[round(s, 4) for s in cv_r2]}")
        print(f"  Mean R²: {mean_r2:.4f} | MAE: {mean_mae:.6f}")

        pipeline.fit(X, y)
        pipelines[horizon_name] = pipeline
        horizon_metrics[horizon_name] = {
            "cv_r2_mean": round(mean_r2, 4),
            "cv_r2_std": round(float(np.std(cv_r2)), 4),
            "cv_r2_scores": [round(float(s), 4) for s in cv_r2],
            "cv_mae": round(mean_mae, 6),
        }

    # 4. Save artifacts
    print(f"\n[4/4] Saving model artifacts...")
    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    existing = list(MODELS_DIR.glob("crypto_model_v*.pkl"))
    if existing:
        versions = [int(f.stem.split("_v")[1]) for f in existing]
        next_version = max(versions) + 1
    else:
        next_version = 1

    model_filename = f"crypto_model_v{next_version}.pkl"
    model_path = MODELS_DIR / model_filename

    # Save all horizon pipelines in one artifact
    artifact = {
        "pipelines": pipelines,
        "horizons": list(HORIZONS.keys()),
    }
    joblib.dump(artifact, model_path)
    print(f"  Saved: {model_path}")

    symbol_map = {idx: sym for idx, (sym, _) in enumerate(SYMBOL_TO_ID.items())}
    metadata = {
        "model_version": f"v{next_version}",
        "model_file": model_filename,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "target": "multi-horizon log_return",
        "horizons": list(HORIZONS.keys()),
        "horizon_steps": HORIZONS,
        "data_window_days": days,
        "symbols": list(SYMBOL_TO_ID.keys()),
        "symbol_id_map": symbol_map,
        "features": FEATURE_COLS,
        "total_samples": len(df),
        "horizon_metrics": horizon_metrics,
        "pipeline_steps": ["StandardScaler", "RandomForestRegressor(n=200, depth=15)"],
    }

    meta_path = MODELS_DIR / "model_metadata.json"
    with open(meta_path, "w") as f:
        json.dump(metadata, f, indent=2)
    print(f"  Metadata: {meta_path}")

    latest_path = MODELS_DIR / "latest.json"
    with open(latest_path, "w") as f:
        json.dump({"model_file": model_filename, "version": f"v{next_version}"}, f)
    print(f"  Latest pointer: {latest_path}")

    print(f"\n{'='*60}")
    print(f"Training complete. Model: {model_filename}")
    for h, m in horizon_metrics.items():
        print(f"  {h}: R²={m['cv_r2_mean']:.4f} | MAE={m['cv_mae']:.6f}")
    print(f"{'='*60}\n")

    return model_path


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train CryptoSkope prediction model")
    parser.add_argument("--days", type=int, default=90, help="Days of historical data")
    args = parser.parse_args()
    train(days=args.days)
