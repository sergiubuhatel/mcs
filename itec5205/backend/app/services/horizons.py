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
        for key in ("lower_95", "upper_95", "band_low", "band_high", "bands"):
            if key in point:
                row[key] = point[key]
        out[label] = row
    return out


# Forecast band ("beam") measured from the model's own multi-step errors, at
# every confidence level the charts let the user pick (percent).
BAND_LEVELS = (50, 75, 80, 90, 95, 99)
DEFAULT_BAND_LEVEL = 95
MIN_BAND_SAMPLES = 30


def backtest_bands(predicted, actual, forecast_prices):
    """Empirical bands around a forward forecast, one per BAND_LEVELS entry.

    `predicted` / `actual` are origins x steps closes from a walk-forward
    backtest over the held-out days: row b is the model's full multi-step
    forecast made on test day b, next to the closes that actually followed
    (NaN past the end of the data). At every step k, the c% band edges are
    the (1-c)/2 and (1+c)/2 quantiles of log(actual / predicted), so each
    point of the band comes from hundreds of real k-day-ahead forecasts rather
    than a formula. Steps with too few samples extend the last measured spread
    by sqrt(k). Returns ({level: (lower, upper)}, info) with lower/upper per
    step, or ({}, None) when the backtest is too short."""
    import numpy as np

    predicted = np.asarray(predicted, dtype=float)
    actual = np.asarray(actual, dtype=float)
    err = np.log(actual / predicted)
    counts = np.sum(~np.isnan(err), axis=0)
    ok = counts >= MIN_BAND_SAMPLES
    if not ok.any():
        return {}, None
    measured = np.flatnonzero(ok)
    prices = np.asarray(forecast_prices, dtype=float)[: err.shape[1]]
    bands = {}
    for level in BAND_LEVELS:
        alpha = (1 - level / 100) / 2
        lo_q, hi_q = np.full(err.shape[1], np.nan), np.full(err.shape[1], np.nan)
        lo_q[ok] = np.nanquantile(err[:, ok], alpha, axis=0)
        hi_q[ok] = np.nanquantile(err[:, ok], 1 - alpha, axis=0)
        for k in np.flatnonzero(~ok):  # beyond the measured horizon: widen like a random walk
            j = measured[-1] if k > measured[-1] else measured[0]
            scale = np.sqrt((k + 1) / (j + 1))
            lo_q[k], hi_q[k] = lo_q[j] * scale, hi_q[j] * scale
        # The band always contains the forecast itself.
        lower = prices * np.exp(np.minimum(lo_q, 0.0)[: len(prices)])
        upper = prices * np.exp(np.maximum(hi_q, 0.0)[: len(prices)])
        bands[level] = (lower.tolist(), upper.tolist())
    info = {
        "method": "backtest",
        "levels": list(BAND_LEVELS),
        "origins": int(err.shape[0]),
        "samples_at_last_step": int(counts[len(prices) - 1]) if len(prices) else 0,
    }
    return bands, info


def band_fields(bands: dict, i: int) -> dict:
    """Per-point band fields: `bands` {"95": [low, high], ...} for every level,
    plus band_low / band_high = the default level (kept for older readers)."""
    if not bands:
        return {}
    out = {"bands": {str(lv): [round(lo[i], 2), round(hi[i], 2)] for lv, (lo, hi) in bands.items()}}
    lo, hi = bands[DEFAULT_BAND_LEVEL]
    out["band_low"], out["band_high"] = round(lo[i], 2), round(hi[i], 2)
    return out
