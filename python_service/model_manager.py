"""
Model manager: loads multi-horizon trained artifacts, handles versioning,
provides inference interface.

The model predicts log_return at multiple horizons (1h, 6h, 24h).
Price is reconstructed: predicted_price = current_price * exp(predicted_log_return)
"""

import json
from pathlib import Path
from typing import Optional

import joblib
import numpy as np

MODELS_DIR = Path(__file__).resolve().parent / "models"


class ModelManager:
    def __init__(self):
        self.pipelines: dict = {}         # {horizon_name: sklearn Pipeline}
        self.horizons: list[str] = []
        self.metadata: dict = {}
        self.loaded_version: Optional[str] = None

    def load_latest(self) -> bool:
        """Load the latest trained model artifact. Returns True if successful."""
        latest_path = MODELS_DIR / "latest.json"
        if not latest_path.exists():
            return False

        with open(latest_path) as f:
            latest = json.load(f)

        model_path = MODELS_DIR / latest["model_file"]
        if not model_path.exists():
            return False

        artifact = joblib.load(model_path)
        self.pipelines = artifact["pipelines"]
        self.horizons = artifact["horizons"]
        self.loaded_version = latest["version"]

        meta_path = MODELS_DIR / "model_metadata.json"
        if meta_path.exists():
            with open(meta_path) as f:
                self.metadata = json.load(f)

        return True

    @property
    def is_loaded(self) -> bool:
        return len(self.pipelines) > 0

    @property
    def symbol_id_map(self) -> dict:
        return self.metadata.get("symbol_id_map", {})

    @property
    def symbol_to_id(self) -> dict:
        return {v: int(k) for k, v in self.symbol_id_map.items()}

    @property
    def features(self) -> list:
        return self.metadata.get("features", [])

    def predict_multi_horizon(
        self, features: np.ndarray, current_price: float,
        market_volatility: float = 0.0,
    ) -> dict:
        """
        Predict price at all trained horizons.

        Returns dict with per-horizon predictions:
        {
            "1h": {"predicted_price": ..., "confidence": ..., "predicted_return": ...},
            "6h": {...},
            "24h": {...},
        }
        """
        if not self.is_loaded:
            raise RuntimeError("No model loaded. Run training/train_model.py first.")

        results = {}
        horizon_metrics = self.metadata.get("horizon_metrics", {})

        for horizon in self.horizons:
            pipeline = self.pipelines[horizon]

            # Predict log return
            predicted_log_return = float(
                pipeline.predict(features.reshape(1, -1))[0]
            )
            predicted_price = current_price * np.exp(predicted_log_return)

            # Confidence from tree variance
            rf_model = pipeline.named_steps["model"]
            scaler = pipeline.named_steps["scaler"]
            scaled = scaler.transform(features.reshape(1, -1))

            tree_preds = np.array(
                [t.predict(scaled)[0] for t in rf_model.estimators_]
            )
            pred_std = float(np.std(tree_preds))

            # Tree agreement: low disagreement → high confidence
            tree_agreement = max(0, 1 - pred_std * 100)

            # CV R² for this horizon
            h_metrics = horizon_metrics.get(horizon, {})
            r2 = h_metrics.get("cv_r2_mean", 0)
            confidence = 0.5 * max(0, min(1, r2)) + 0.5 * tree_agreement
            confidence = max(0, min(1, round(confidence, 4)))

            price_change_pct = (predicted_price - current_price) / current_price * 100

            # Asymmetric prediction intervals from tree percentiles
            # Use actual distribution shape instead of assuming symmetry
            p5 = float(np.percentile(tree_preds, 5))
            p25 = float(np.percentile(tree_preds, 25))
            p75 = float(np.percentile(tree_preds, 75))
            p95 = float(np.percentile(tree_preds, 95))

            # Adjust intervals by market volatility (widens during volatile periods)
            # market_volatility is the 7-day rolling std of log returns
            vol_factor = 1 + max(0, market_volatility * 50) if market_volatility > 0 else 1.0

            # Minimum interval half-width based on horizon and market volatility.
            # The tree percentile spread is often too narrow because 200 trees
            # agree on near-zero returns. We enforce a volatility-based floor so
            # intervals realistically reflect how much crypto actually moves.
            #
            # Formula: sigma_h = hourly_vol * sqrt(hours)
            # 90% interval ≈ ±1.65 * sigma_h (Gaussian approximation)
            # 50% interval ≈ ±0.675 * sigma_h
            horizon_hours = {"1h": 1, "6h": 6, "24h": 24}.get(horizon, 1)
            base_vol = max(market_volatility, 0.008) if market_volatility > 0 else 0.008
            sigma_h = base_vol * np.sqrt(horizon_hours)
            min_half_90 = sigma_h * 1.65
            min_half_50 = sigma_h * 0.675

            # Use the WIDER of tree-based intervals vs volatility floor
            tree_90_low = p5 * vol_factor
            tree_90_high = p95 * vol_factor
            tree_50_low = p25 * vol_factor
            tree_50_high = p75 * vol_factor

            # Volatility-based floor centered on the predicted return
            vol_90_low = predicted_log_return - min_half_90
            vol_90_high = predicted_log_return + min_half_90
            vol_50_low = predicted_log_return - min_half_50
            vol_50_high = predicted_log_return + min_half_50

            # Take the wider bound at each side
            range_90_low = min(tree_90_low, vol_90_low)
            range_90_high = max(tree_90_high, vol_90_high)
            range_50_low = min(tree_50_low, vol_50_low)
            range_50_high = max(tree_50_high, vol_50_high)

            # Adaptive rounding: more decimals for low-price assets
            decimals = 2 if current_price >= 1 else 6

            results[horizon] = {
                "predicted_price": round(float(predicted_price), decimals),
                "price_range_90": [
                    round(current_price * np.exp(range_90_low), decimals),
                    round(current_price * np.exp(range_90_high), decimals),
                ],
                "price_range_50": [
                    round(current_price * np.exp(range_50_low), decimals),
                    round(current_price * np.exp(range_50_high), decimals),
                ],
                "predicted_return_pct": round(price_change_pct, 4),
                "confidence": confidence,
                "cv_r2": round(r2, 4),
            }

        return results

    def get_info(self) -> dict:
        if not self.is_loaded:
            return {"status": "no_model_loaded"}

        horizon_metrics = self.metadata.get("horizon_metrics", {})
        return {
            "version": self.loaded_version,
            "trained_at": self.metadata.get("trained_at"),
            "target": self.metadata.get("target", "multi-horizon log_return"),
            "horizons": self.horizons,
            "horizon_metrics": {
                h: {"cv_r2": m.get("cv_r2_mean"), "cv_mae": m.get("cv_mae")}
                for h, m in horizon_metrics.items()
            },
            "symbols": self.metadata.get("symbols", []),
            "features": self.features,
            "total_training_samples": self.metadata.get("total_samples"),
            "pipeline_steps": self.metadata.get("pipeline_steps", []),
        }


# Singleton instance
manager = ModelManager()
