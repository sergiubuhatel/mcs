"""Where a portfolio is heading: its holdings' stored LSTM and ARIMA price
forecasts combined with the portfolio weights, plus a band per model at the chosen confidence level (50-99%, default 95%).

Growth of the portfolio from today, k business days ahead, with fixed
weights w_i and last closes L_i:

    G(k) = sum_i w_i * F_i(k) / L_i          (one path per model)

Each stored forecast carries its own bands, measured at every daily step and
confidence level from the model's walk-forward backtest errors (`bands`).
A stock's band gives how far below / above its forecast it can land, as a
fraction of its price: d_i(k) = (F_i - low_i) / L_i, u_i(k) = (high_i - F_i) / L_i.
Stocks don't move independently, so the portfolio's spread on each side is
sqrt(v' C v) with v_i = w_i * d_i(k) (resp. u_i) and C the correlation of
the holdings' daily returns over the past year -- adding the stock bands up
would overstate the risk, ignoring correlation would understate it.

Older forecasts with only a 95% band (measured, or ARIMA's model interval
`lower_95` / `upper_95`) have it scaled by z(level) / z(95); a holding
without any band, or without a forecast at all (assumed flat, F = L, and
listed in `missing`), uses its own past-year volatility, z * daily stdev * sqrt(k).
"""

from statistics import NormalDist

import numpy as np

from ..db.arango_client import get_db
from .horizons import DEFAULT_BAND_LEVEL
from .portfolio_service import _returns_matrix

Z95 = 1.959964
CORRELATION_DAYS = 252
HORIZONS = {"1M": 21, "2M": 42, "3M": 63, "4M": 84}


def _forecasts(collection: str, tickers: list[str]) -> dict[str, dict]:
    docs = get_db().collection(collection).get_many(tickers)
    return {d["_key"]: d for d in docs if d.get("forecast") and d.get("last_actual_close")}


def _fit_steps(values: list[float], steps: int) -> np.ndarray:
    values = list(values[:steps])
    values += [values[-1]] * (steps - len(values))  # hold the last value if shorter
    return np.array(values, dtype=float)


def _point_band(p: dict, level: int, fallback_keys: tuple[str, str] | None):
    """(low, high, source) of one forecast point at `level`%: the measured band
    at that level; else a 95% band (measured, or the model interval) scaled
    around the forecast by z(level) / z(95); else None."""
    measured = (p.get("bands") or {}).get(str(level))
    if measured:
        return measured[0], measured[1], "backtest"
    for lo_key, hi_key, source in (("band_low", "band_high", "backtest"), (*(fallback_keys or ("", "")), "model")):
        if lo_key and p.get(lo_key) is not None:
            scale = NormalDist().inv_cdf(0.5 + level / 200) / Z95
            mid = p["predicted_close"]
            return mid - (mid - p[lo_key]) * scale, mid + (p[hi_key] - mid) * scale, source
    return None


def portfolio_forecast(holdings: list[dict], level: int = DEFAULT_BAND_LEVEL) -> dict | None:
    """{dates, steps, lstm, arima, lstm_lower, lstm_upper, arima_lower,
    arima_upper (growth factors, 1 = today; lower/upper = arima band, kept
    for older pages), horizons {1M: {...}}, band_source, missing {lstm, arima},
    data_end}; None when no holding has any forecast."""
    tickers = [h["ticker"] for h in holdings]
    weights = np.array([h["weight"] for h in holdings], dtype=float)
    weights = weights / weights.sum()
    lstm, arima = _forecasts("price_predictions", tickers), _forecasts("arima_predictions", tickers)
    if not lstm and not arima:
        return None

    # The forecast calendar: the longest stored ARIMA (else LSTM) forecast.
    reference = max((arima or lstm).values(), key=lambda d: len(d["forecast"]))
    dates = [p["date"] for p in reference["forecast"]]
    steps = len(dates)

    returns = _returns_matrix(tickers, lookback_days=CORRELATION_DAYS).reindex(columns=tickers)
    daily_sd = returns.std().fillna(0.0).to_numpy(copy=True)
    corr = returns.corr().fillna(0.0).to_numpy(copy=True)
    np.fill_diagonal(corr, 1.0)
    k = np.arange(1, steps + 1)[:, None]
    vol_spread = NormalDist().inv_cdf(0.5 + level / 200) * daily_sd[None, :] * np.sqrt(k)  # fallback, fraction of price

    def model_paths(forecasts: dict[str, dict], fallback_keys: tuple[str, str] | None):
        """Portfolio growth path and its band for one model, plus which
        source each holding's band came from."""
        growth = np.ones((steps, len(tickers)))
        down, up = vol_spread.copy(), vol_spread.copy()
        sources = {}
        for j, t in enumerate(tickers):
            doc = forecasts.get(t)
            if not doc:
                sources[t] = "volatility"
                continue
            last = float(doc["last_actual_close"])
            points = doc["forecast"]
            mid = _fit_steps([p["predicted_close"] for p in points], steps)
            growth[:, j] = mid / last
            band = [_point_band(p, level, fallback_keys) for p in points]
            if all(band):
                down[:, j] = (mid - _fit_steps([b[0] for b in band], steps)) / last
                up[:, j] = (_fit_steps([b[1] for b in band], steps) - mid) / last
                sources[t] = band[0][2]
            else:
                sources[t] = "volatility"
        path = growth @ weights

        def spread(s):
            v = np.maximum(s, 0.0) * weights[None, :]
            return np.sqrt(np.maximum(np.einsum("ki,ij,kj->k", v, corr, v), 0.0))

        return path, path - spread(down), path + spread(up), sources

    lstm_path, lstm_lo, lstm_hi, lstm_src = model_paths(lstm, None)
    arima_path, arima_lo, arima_hi, arima_src = model_paths(arima, ("lower_95", "upper_95"))

    r = lambda a: [round(float(x), 6) for x in a]  # noqa: E731
    horizons = {
        name: {
            "lstm": float(lstm_path[d - 1]), "lstm_lower": float(lstm_lo[d - 1]), "lstm_upper": float(lstm_hi[d - 1]),
            "arima": float(arima_path[d - 1]), "lower": float(arima_lo[d - 1]), "upper": float(arima_hi[d - 1]),
            "date": dates[d - 1],
        }
        for name, d in HORIZONS.items() if d <= steps
    }
    return {
        "dates": dates,
        "steps": steps,
        "lstm": r(lstm_path),
        "lstm_lower": r(lstm_lo),
        "lstm_upper": r(lstm_hi),
        "arima": r(arima_path),
        "lower": r(arima_lo),
        "upper": r(arima_hi),
        "horizons": horizons,
        "level": level,
        "band_source": {"lstm": lstm_src, "arima": arima_src},
        "missing": {"lstm": [t for t in tickers if t not in lstm], "arima": [t for t in tickers if t not in arima]},
        "data_end": reference.get("data_end"),
    }
