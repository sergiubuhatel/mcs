"""Forecast horizons at which LSTM and ARIMA directions are compared.

1-4 months, in trading days (21 per month). Both forecasters produce
MAX_HORIZON_DAYS daily steps by default so every horizon is covered.
"""

HORIZONS = {"1M": 21, "2M": 42, "3M": 63, "4M": 84}
MAX_HORIZON_DAYS = max(HORIZONS.values())


def horizon_points(forecast: list[dict], last_close: float) -> dict:
    """{label: {days, date, predicted_close, change_pct[, lower_95, upper_95]}} for
    every horizon the forecast reaches (change is vs. the last actual close)."""
    out = {}
    for label, days in HORIZONS.items():
        if len(forecast) < days:
            continue
        point = forecast[days - 1]
        row = {
            "days": days,
            "date": point["date"],
            "predicted_close": point["predicted_close"],
            "change_pct": round((point["predicted_close"] / last_close - 1.0) * 100, 3) if last_close else None,
        }
        for key in ("lower_95", "upper_95", "band_low", "band_high"):
            if key in point:
                row[key] = point[key]
        out[label] = row
    return out


# Forecast band ("beam") measured from the model's own multi-step errors.
BAND_COVERAGE = 0.95
MIN_BAND_SAMPLES = 30


def backtest_band(predicted, actual, forecast_prices):
    """Empirical 95% band around a forward forecast.

    `predicted` / `actual` are origins x steps closes from a walk-forward
    backtest over the held-out days: row b is the model's full multi-step
    forecast made on test day b, next to the closes that actually followed
    (NaN past the end of the data). At every step k the band edges are the
    2.5% / 97.5% quantiles of log(actual / predicted), so each point of the
    band comes from hundreds of real k-day-ahead forecasts rather than a
    formula. Steps with too few samples extend the last measured spread by
    sqrt(k). Returns (lower, upper, info) with lower/upper per step."""
    import numpy as np

    predicted = np.asarray(predicted, dtype=float)
    actual = np.asarray(actual, dtype=float)
    err = np.log(actual / predicted)
    counts = np.sum(~np.isnan(err), axis=0)
    alpha = (1 - BAND_COVERAGE) / 2
    lo_q, hi_q = np.full(err.shape[1], np.nan), np.full(err.shape[1], np.nan)
    ok = counts >= MIN_BAND_SAMPLES
    if not ok.any():
        return None, None, None
    lo_q[ok] = np.nanquantile(err[:, ok], alpha, axis=0)
    hi_q[ok] = np.nanquantile(err[:, ok], 1 - alpha, axis=0)
    last = int(np.flatnonzero(ok)[-1])
    for k in range(err.shape[1]):
        if not ok[k]:  # beyond the measured horizon: widen like a random walk
            j = last if k > last else int(np.flatnonzero(ok)[0])
            scale = np.sqrt((k + 1) / (j + 1))
            lo_q[k], hi_q[k] = lo_q[j] * scale, hi_q[j] * scale
    prices = np.asarray(forecast_prices, dtype=float)[: err.shape[1]]
    lower = prices * np.exp(np.minimum(lo_q, 0.0)[: len(prices)])
    upper = prices * np.exp(np.maximum(hi_q, 0.0)[: len(prices)])
    info = {
        "method": "backtest",
        "coverage": BAND_COVERAGE,
        "origins": int(err.shape[0]),
        "samples_at_last_step": int(counts[len(prices) - 1]) if len(prices) else 0,
    }
    return lower.tolist(), upper.tolist(), info
