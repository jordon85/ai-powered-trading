import numpy as np


def calculate_risk(symbol: str, data: list):
    """
    Composite risk score based on:
    - Volatility (annualized std of returns)
    - Maximum drawdown (worst peak-to-trough decline)
    - Price instability (coefficient of variation)
    - Downside momentum (recent negative trend strength)
    - Sharpe ratio (risk-adjusted return)

    Weighted formula:
      risk = 0.30 * volatility_score
           + 0.25 * drawdown_score
           + 0.15 * instability_score
           + 0.15 * momentum_score
           + 0.15 * sharpe_score

    All sub-scores normalized to 0-100 scale. Final risk_score is 0-100.
    """
    if not data or len(data) < 2:
        return {
            "symbol": symbol,
            "risk_score": 0,
            "risk_label": "insufficient_data",
            "volatility": 0,
            "max_drawdown": 0,
            "sharpe_ratio": 0,
            "details": {"error": "Need at least 2 data points"},
        }

    # Validate numeric
    prices = []
    for x in data:
        if not isinstance(x, (int, float)):
            raise ValueError(f"Non-numeric value in data: {x}")
        prices.append(float(x))

    prices = np.array(prices)
    returns = np.diff(prices) / prices[:-1]

    # --- 1. Volatility (annualized) ---
    daily_vol = float(np.std(returns))
    annualized_vol = daily_vol * np.sqrt(365)
    volatility_score = min(100, annualized_vol * 100)

    # --- 2. Maximum Drawdown ---
    cumulative_max = np.maximum.accumulate(prices)
    drawdowns = (cumulative_max - prices) / cumulative_max
    max_drawdown = float(np.max(drawdowns))
    drawdown_score = min(100, max_drawdown * 200)

    # --- 3. Price Instability (coefficient of variation) ---
    mean_price = float(np.mean(prices))
    std_price = float(np.std(prices))
    coeff_variation = std_price / mean_price if mean_price != 0 else 0
    instability_score = min(100, coeff_variation * 200)

    # --- 4. Downside Momentum ---
    split = max(1, len(prices) - max(1, len(prices) // 5))
    recent_mean = float(np.mean(prices[split:]))
    earlier_mean = float(np.mean(prices[:split]))
    trend = (recent_mean - earlier_mean) / earlier_mean if earlier_mean != 0 else 0
    momentum_score = min(100, max(0, -trend * 500))

    # --- 5. Sharpe Ratio (risk-adjusted return) ---
    mean_return = float(np.mean(returns))
    std_return = float(np.std(returns)) if len(returns) > 1 else 1.0
    sharpe = mean_return / std_return if std_return != 0 else 0
    annualized_sharpe = sharpe * np.sqrt(365)
    # Low/negative Sharpe → high risk. Sharpe > 2 → low risk
    sharpe_risk_score = min(100, max(0, (2 - annualized_sharpe) * 33.3))

    # --- Composite Risk Score ---
    risk_score = (
        0.30 * volatility_score
        + 0.25 * drawdown_score
        + 0.15 * instability_score
        + 0.15 * momentum_score
        + 0.15 * sharpe_risk_score
    )
    risk_score = round(min(100, max(0, risk_score)), 2)

    # Risk label
    if risk_score < 20:
        risk_label = "low"
    elif risk_score < 40:
        risk_label = "moderate"
    elif risk_score < 60:
        risk_label = "high"
    elif risk_score < 80:
        risk_label = "very_high"
    else:
        risk_label = "extreme"

    return {
        "symbol": symbol,
        "risk_score": risk_score,
        "risk_label": risk_label,
        "volatility": round(annualized_vol, 4),
        "max_drawdown": round(max_drawdown, 4),
        "sharpe_ratio": round(float(annualized_sharpe), 4),
        "data_points": len(prices),
        "details": {
            "volatility_score": round(volatility_score, 2),
            "drawdown_score": round(drawdown_score, 2),
            "instability_score": round(instability_score, 2),
            "momentum_score": round(momentum_score, 2),
            "sharpe_score": round(sharpe_risk_score, 2),
            "weights": "vol=0.30, drawdown=0.25, instability=0.15, momentum=0.15, sharpe=0.15",
        },
    }
