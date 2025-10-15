from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List

from model_manager import manager
from ml_model import predict_price
from data_processing import aggregate_data, scrape_data
from blockchain import get_balance
from risk_analysis import calculate_risk
from indicators import get_indicators
from prediction_tracker import (
    log_all_horizons, backfill_actuals,
    get_accuracy_stats, get_recent_predictions,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: load trained model
    if manager.load_latest():
        print(f"Model loaded: {manager.loaded_version}")
    else:
        print("WARNING: No trained model found. Run: python training/train_model.py")
    yield
    # Shutdown: nothing to clean up


app = FastAPI(title="CryptoSkope API", version="2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SymbolRequest(BaseModel):
    symbol: str


class DataRequest(BaseModel):
    url: str


class BlockchainRequest(BaseModel):
    address: str


class RiskRequest(BaseModel):
    symbol: str
    data: List[float]


@app.get("/")
async def health_check():
    return {
        "status": "ok",
        "version": "2.0",
        "model_loaded": manager.is_loaded,
    }


@app.get("/model/info")
async def model_info():
    return manager.get_info()


@app.post("/predict")
async def predict(req: SymbolRequest):
    try:
        result = await predict_price(req.symbol)
        # Auto-log prediction for tracking
        if "predictions" in result and "current_price" in result:
            try:
                log_all_horizons(result["symbol"], result["current_price"], result["predictions"])
            except Exception:
                pass  # Tracking failure should never block prediction
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/aggregate")
async def aggregate():
    try:
        return await aggregate_data()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/scrape")
async def scrape(req: DataRequest):
    try:
        return await scrape_data(req.url)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/blockchain/balance")
async def balance(req: BlockchainRequest):
    try:
        return get_balance(req.address)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/risk")
async def risk(req: RiskRequest):
    try:
        return calculate_risk(req.symbol, req.data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/market/indicators")
async def market_indicators(symbol: str = "BTC"):
    try:
        return await get_indicators(symbol)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Prediction Tracking Endpoints ──────────────────────────────

@app.post("/predictions/backfill")
async def backfill():
    """Backfill actual prices for elapsed predictions."""
    try:
        count = await backfill_actuals()
        return {"backfilled": count}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/predictions/accuracy")
async def accuracy(symbol: str = None):
    """Get prediction accuracy statistics."""
    try:
        return get_accuracy_stats(symbol)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/predictions/history")
async def prediction_history(symbol: str = None, limit: int = 20):
    """Get recent predictions with outcomes."""
    try:
        return get_recent_predictions(symbol, min(limit, 100))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
