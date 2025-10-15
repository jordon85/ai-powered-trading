import numpy as np
import pandas as pd
import httpx
from cachetools import TTLCache

_indicator_cache: TTLCache = TTLCache(maxsize=32, ttl=300)

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
    "MATIC": "matic-network",
    "LINK": "chainlink",
    "UNI": "uniswap",
    "ATOM": "cosmos",
    "LTC": "litecoin",
    "SHIB": "shiba-inu",
    "THETA": "theta-token",
    "TDROP": "thetadrop",
}


async def _fetch_prices(coin_id: str, days: int = 90) -> pd.DataFrame:
    cache_key = f"ind_{coin_id}_{days}"
    if cache_key in _indicator_cache:
        return _indicator_cache[cache_key].copy()

    url = f"https://api.coingecko.com/api/v3/coins/{coin_id}/market_chart"
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(url, params={"vs_currency": "usd", "days": days})
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

    _indicator_cache[cache_key] = df
    return df.copy()


def _compute_rsi(prices: pd.Series, period: int = 14) -> float:
    """Relative Strength Index."""
    delta = prices.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)

    avg_gain = gain.rolling(window=period).mean()
    avg_loss = loss.rolling(window=period).mean()

    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    return round(float(rsi.iloc[-1]), 2)


def _compute_macd(prices: pd.Series) -> dict:
    """MACD (12, 26, 9)."""
    ema12 = prices.ewm(span=12, adjust=False).mean()
    ema26 = prices.ewm(span=26, adjust=False).mean()
    macd_line = ema12 - ema26
    signal_line = macd_line.ewm(span=9, adjust=False).mean()
    histogram = macd_line - signal_line

    return {
        "macd_line": round(float(macd_line.iloc[-1]), 4),
        "signal_line": round(float(signal_line.iloc[-1]), 4),
        "histogram": round(float(histogram.iloc[-1]), 4),
        "signal": "bullish" if histogram.iloc[-1] > 0 else "bearish",
    }


def _compute_bollinger(prices: pd.Series, period: int = 20, std_dev: float = 2.0) -> dict:
    """Bollinger Bands."""
    sma = prices.rolling(window=period).mean()
    rolling_std = prices.rolling(window=period).std()
    upper = sma + std_dev * rolling_std
    lower = sma - std_dev * rolling_std

    current = float(prices.iloc[-1])
    upper_val = float(upper.iloc[-1])
    lower_val = float(lower.iloc[-1])
    band_width = upper_val - lower_val

    # %B: position within bands (0 = lower, 1 = upper)
    pct_b = (current - lower_val) / band_width if band_width != 0 else 0.5

    return {
        "upper_band": round(upper_val, 2),
        "middle_band": round(float(sma.iloc[-1]), 2),
        "lower_band": round(lower_val, 2),
        "band_width": round(band_width, 2),
        "percent_b": round(pct_b, 4),
    }


async def get_indicators(symbol: str):
    symbol = symbol.upper()
    coin_id = SYMBOL_TO_ID.get(symbol)
    if not coin_id:
        return {"error": f"Unknown symbol: {symbol}. Supported: {list(SYMBOL_TO_ID.keys())}"}

    df = await _fetch_prices(coin_id, days=90)
    prices = df["price"]

    if len(prices) < 30:
        return {"error": "Insufficient data for indicator calculation"}

    current_price = float(prices.iloc[-1])

    # RSI
    rsi_14 = _compute_rsi(prices, period=14)
    if rsi_14 > 70:
        rsi_signal = "overbought"
    elif rsi_14 < 30:
        rsi_signal = "oversold"
    else:
        rsi_signal = "neutral"

    # MACD
    macd = _compute_macd(prices)

    # Bollinger Bands
    bollinger = _compute_bollinger(prices)

    # Momentum (7-period and 14-period)
    momentum_7 = round((float(prices.iloc[-1]) / float(prices.iloc[-7]) - 1) * 100, 4) if len(prices) >= 7 else 0
    momentum_14 = round((float(prices.iloc[-1]) / float(prices.iloc[-14]) - 1) * 100, 4) if len(prices) >= 14 else 0

    # Volatility (annualized)
    returns = prices.pct_change().dropna()
    vol_7d = float(returns.tail(7).std()) * np.sqrt(365 * 24)  # hourly data
    vol_30d = float(returns.tail(30).std()) * np.sqrt(365 * 24)

    # Volume analysis
    volume_data = {}
    if "volume" in df.columns:
        vol = df["volume"]
        vol_ma7 = vol.rolling(7).mean()
        volume_data = {
            "current_volume": round(float(vol.iloc[-1]), 0),
            "avg_volume_7d": round(float(vol_ma7.iloc[-1]), 0),
            "volume_ratio": round(float(vol.iloc[-1]) / float(vol_ma7.iloc[-1]), 4) if float(vol_ma7.iloc[-1]) != 0 else 0,
        }

    return {
        "symbol": symbol,
        "current_price": round(current_price, 2),
        "rsi": {
            "value": rsi_14,
            "period": 14,
            "signal": rsi_signal,
        },
        "macd": macd,
        "bollinger_bands": bollinger,
        "momentum": {
            "7d_pct": momentum_7,
            "14d_pct": momentum_14,
        },
        "volatility": {
            "7d_annualized": round(vol_7d, 4),
            "30d_annualized": round(vol_30d, 4),
        },
        "volume": volume_data,
        "data_points": len(prices),
    }
