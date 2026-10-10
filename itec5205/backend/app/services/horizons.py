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
        if "lower_95" in point:
            row["lower_95"] = point["lower_95"]
            row["upper_95"] = point["upper_95"]
        out[label] = row
    return out
