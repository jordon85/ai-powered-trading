"""
Prediction Tracking System

Stores predictions with timestamps, backfills actual prices when the horizon
elapses, and computes accuracy metrics (MAE, direction accuracy, hit rate).

Uses SQLite for lightweight persistence — no external DB needed.
"""

import sqlite3
import os
import time
import asyncio
from datetime import datetime, timezone
from typing import Optional

import httpx

DB_PATH = os.path.join(os.path.dirname(__file__), "predictions.db")

COINGECKO_IDS = {
    "BTC": "bitcoin", "ETH": "ethereum", "SOL": "solana",
    "BNB": "binancecoin", "XRP": "ripple", "ADA": "cardano",
    "DOGE": "dogecoin", "DOT": "polkadot", "AVAX": "avalanche-2",
    "LINK": "chainlink", "THETA": "theta-token", "TDROP": "thetadrop",
}

HORIZON_SECONDS = {"1h": 3600, "6h": 21600, "24h": 86400}


def _get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE IF NOT EXISTS predictions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            horizon TEXT NOT NULL,
            predicted_at TEXT NOT NULL,
            predicted_at_ts REAL NOT NULL,
            current_price REAL NOT NULL,
            predicted_price REAL NOT NULL,
            predicted_return_pct REAL NOT NULL,
            range_low_90 REAL,
            range_high_90 REAL,
            actual_price REAL,
            actual_return_pct REAL,
            absolute_error REAL,
            direction_correct INTEGER,
            in_range_90 INTEGER,
            backfilled_at TEXT
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_pred_symbol_horizon
        ON predictions(symbol, horizon)
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_pred_backfill
        ON predictions(backfilled_at, predicted_at_ts)
    """)
    conn.commit()
    return conn


def log_prediction(
    symbol: str,
    horizon: str,
    current_price: float,
    predicted_price: float,
    predicted_return_pct: float,
    range_low_90: Optional[float] = None,
    range_high_90: Optional[float] = None,
) -> int:
    """Store a new prediction. Returns the row ID."""
    now = datetime.now(timezone.utc)
    conn = _get_db()
    try:
        cur = conn.execute(
            """INSERT INTO predictions
               (symbol, horizon, predicted_at, predicted_at_ts,
                current_price, predicted_price, predicted_return_pct,
                range_low_90, range_high_90)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                symbol, horizon, now.isoformat(), now.timestamp(),
                current_price, predicted_price, predicted_return_pct,
                range_low_90, range_high_90,
            ),
        )
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


_LOG_COOLDOWN = 300  # 5 minutes between logs for same symbol


def log_all_horizons(symbol: str, current_price: float, predictions: dict):
    """Log predictions for all horizons at once (called after /predict).
    Skips if same symbol was logged within the cooldown period."""
    now_ts = time.time()
    conn = _get_db()
    try:
        # Check cooldown: was this symbol logged recently?
        last = conn.execute(
            "SELECT MAX(predicted_at_ts) FROM predictions WHERE symbol = ?",
            (symbol,),
        ).fetchone()
        if last and last[0] and (now_ts - last[0]) < _LOG_COOLDOWN:
            return  # Skip — too recent
    finally:
        conn.close()

    for horizon, pred in predictions.items():
        range_90 = pred.get("price_range_90", [None, None])
        log_prediction(
            symbol=symbol,
            horizon=horizon,
            current_price=current_price,
            predicted_price=pred["predicted_price"],
            predicted_return_pct=pred["predicted_return_pct"],
            range_low_90=range_90[0] if range_90 else None,
            range_high_90=range_90[1] if range_90 else None,
        )


async def _fetch_price(symbol: str) -> Optional[float]:
    """Fetch current price from CoinGecko."""
    coin_id = COINGECKO_IDS.get(symbol)
    if not coin_id:
        return None
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://api.coingecko.com/api/v3/simple/price",
                params={"ids": coin_id, "vs_currencies": "usd"},
            )
            if resp.status_code == 200:
                data = resp.json()
                return data.get(coin_id, {}).get("usd")
    except Exception:
        return None
    return None


async def backfill_actuals():
    """
    Find predictions whose horizon has elapsed but haven't been backfilled yet.
    Fetch actual prices and compute error metrics.
    Returns count of backfilled rows.
    """
    now_ts = time.time()
    conn = _get_db()
    try:
        rows = conn.execute(
            """SELECT id, symbol, horizon, predicted_at_ts,
                      current_price, predicted_price, predicted_return_pct,
                      range_low_90, range_high_90
               FROM predictions
               WHERE backfilled_at IS NULL
               ORDER BY predicted_at_ts ASC
               LIMIT 50"""
        ).fetchall()

        if not rows:
            return 0

        # Filter to rows whose horizon has actually elapsed
        eligible = []
        for row in rows:
            horizon_secs = HORIZON_SECONDS.get(row["horizon"], 3600)
            if now_ts >= row["predicted_at_ts"] + horizon_secs:
                eligible.append(row)

        if not eligible:
            return 0

        # Group by symbol to minimize API calls
        symbols_needed = set(r["symbol"] for r in eligible)
        prices = {}
        for sym in symbols_needed:
            price = await _fetch_price(sym)
            if price is not None:
                prices[sym] = price
            # Rate limit between calls
            await asyncio.sleep(1.5)

        backfilled = 0
        now_iso = datetime.now(timezone.utc).isoformat()

        for row in eligible:
            actual = prices.get(row["symbol"])
            if actual is None:
                continue

            actual_return = ((actual - row["current_price"]) / row["current_price"]) * 100
            abs_error = abs(row["predicted_price"] - actual)

            # Direction accuracy: did we predict the right direction?
            pred_direction = 1 if row["predicted_return_pct"] > 0 else (-1 if row["predicted_return_pct"] < 0 else 0)
            actual_direction = 1 if actual_return > 0 else (-1 if actual_return < 0 else 0)
            direction_correct = 1 if pred_direction == actual_direction else 0

            # Was actual price within 90% prediction interval?
            in_range = None
            if row["range_low_90"] is not None and row["range_high_90"] is not None:
                in_range = 1 if row["range_low_90"] <= actual <= row["range_high_90"] else 0

            conn.execute(
                """UPDATE predictions SET
                   actual_price = ?, actual_return_pct = ?,
                   absolute_error = ?, direction_correct = ?,
                   in_range_90 = ?, backfilled_at = ?
                   WHERE id = ?""",
                (actual, actual_return, abs_error, direction_correct, in_range, now_iso, row["id"]),
            )
            backfilled += 1

        conn.commit()
        return backfilled
    finally:
        conn.close()


def get_accuracy_stats(symbol: Optional[str] = None) -> dict:
    """
    Compute accuracy statistics from backfilled predictions.
    Optionally filter by symbol.
    """
    conn = _get_db()
    try:
        where = "WHERE backfilled_at IS NOT NULL"
        params: list = []
        if symbol:
            where += " AND symbol = ?"
            params.append(symbol.upper())

        # Per-horizon stats
        horizons = {}
        for h in HORIZON_SECONDS:
            rows = conn.execute(
                f"""SELECT
                    COUNT(*) as total,
                    AVG(absolute_error) as mae,
                    AVG(direction_correct) as direction_accuracy,
                    AVG(in_range_90) as range_hit_rate,
                    AVG(ABS(predicted_return_pct - actual_return_pct)) as avg_return_error,
                    MIN(absolute_error) as best_prediction,
                    MAX(absolute_error) as worst_prediction
                FROM predictions
                {where} AND horizon = ?""",
                params + [h],
            ).fetchone()

            if rows and rows["total"] > 0:
                horizons[h] = {
                    "total_predictions": rows["total"],
                    "mae": round(rows["mae"], 2) if rows["mae"] else None,
                    "direction_accuracy": round(rows["direction_accuracy"] * 100, 1) if rows["direction_accuracy"] is not None else None,
                    "range_hit_rate_90": round(rows["range_hit_rate"] * 100, 1) if rows["range_hit_rate"] is not None else None,
                    "avg_return_error_pct": round(rows["avg_return_error"], 4) if rows["avg_return_error"] else None,
                    "best_prediction_error": round(rows["best_prediction"], 2) if rows["best_prediction"] is not None else None,
                    "worst_prediction_error": round(rows["worst_prediction"], 2) if rows["worst_prediction"] is not None else None,
                }

        # Overall stats
        overall = conn.execute(
            f"""SELECT
                COUNT(*) as total,
                AVG(absolute_error) as mae,
                AVG(direction_correct) as direction_accuracy,
                AVG(in_range_90) as range_hit_rate
            FROM predictions
            {where}""",
            params,
        ).fetchone()

        # Total logged (including not-yet-backfilled)
        pending_where = "WHERE backfilled_at IS NULL"
        pending_params: list = []
        if symbol:
            pending_where += " AND symbol = ?"
            pending_params.append(symbol.upper())

        pending = conn.execute(
            f"SELECT COUNT(*) as cnt FROM predictions {pending_where}",
            pending_params,
        ).fetchone()

        return {
            "symbol": symbol.upper() if symbol else "ALL",
            "horizons": horizons,
            "overall": {
                "total_evaluated": overall["total"] if overall else 0,
                "mae": round(overall["mae"], 2) if overall and overall["mae"] else None,
                "direction_accuracy": round(overall["direction_accuracy"] * 100, 1) if overall and overall["direction_accuracy"] is not None else None,
                "range_hit_rate_90": round(overall["range_hit_rate"] * 100, 1) if overall and overall["range_hit_rate"] is not None else None,
            },
            "pending_backfill": pending["cnt"] if pending else 0,
        }
    finally:
        conn.close()


def get_recent_predictions(symbol: Optional[str] = None, limit: int = 20) -> list:
    """Get recent predictions with their outcomes (for chart overlay)."""
    conn = _get_db()
    try:
        where = "WHERE 1=1"
        params: list = []
        if symbol:
            where += " AND symbol = ?"
            params.append(symbol.upper())

        rows = conn.execute(
            f"""SELECT symbol, horizon, predicted_at, predicted_at_ts,
                       current_price, predicted_price, predicted_return_pct,
                       range_low_90, range_high_90,
                       actual_price, actual_return_pct, absolute_error,
                       direction_correct, in_range_90, backfilled_at
                FROM predictions
                {where}
                ORDER BY predicted_at_ts DESC
                LIMIT ?""",
            params + [limit],
        ).fetchall()

        return [dict(r) for r in rows]
    finally:
        conn.close()
