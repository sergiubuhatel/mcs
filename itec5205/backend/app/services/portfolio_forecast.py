"""Where a portfolio is heading: its holdings' stored LSTM and ARIMA price
forecasts combined with the portfolio weights, plus a 95% band.

Growth of the portfolio from today, k business days ahead, with fixed
weights w_i and last closes L_i:

    G(k) = sum_i w_i * F_i(k) / L_i          (one path per model)

The band uses ARIMA's per-stock 95% intervals. A stock's interval gives its
own standard deviation s_i(k) = (upper - lower) / (2 * 1.96) / L_i (as a
fraction of its price). Stocks don't move independently, so the portfolio's
standard deviation is sqrt(v' C v) with v_i = w_i * s_i(k) and C the
correlation of the holdings' daily returns over the past year -- adding the
stock bands up would overstate the risk, ignoring correlation would
understate it.

A holding without a stored forecast is assumed flat (F = L) and gets a band
from its own past-year volatility, s_i(k) = daily stdev * sqrt(k); it is
listed in `missing` so the page can say so.
"""

import numpy as np

from ..db.arango_client import get_db
from .portfolio_service import _returns_matrix

Z95 = 1.959964
CORRELATION_DAYS = 252
HORIZONS = {"1M": 21, "2M": 42, "3M": 63, "4M": 84}


def _forecasts(collection: str, tickers: list[str]) -> dict[str, dict]:
    docs = get_db().collection(collection).get_many(tickers)
    return {d["_key"]: d for d in docs if d.get("forecast") and d.get("last_actual_close")}


def portfolio_forecast(holdings: list[dict]) -> dict | None:
    """{dates, lstm, arima, lower, upper (growth factors, 1 = today), steps,
    horizons {1M: {lstm, arima, lower, upper}}, missing {lstm, arima},
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

    def growth_paths(forecasts: dict[str, dict]) -> np.ndarray:
        """steps x n growth factors F_i(k) / L_i; flat (1.0) when missing."""
        out = np.ones((steps, len(tickers)))
        for j, t in enumerate(tickers):
            doc = forecasts.get(t)
            if not doc:
                continue
            closes = [p["predicted_close"] for p in doc["forecast"]][:steps]
            closes += [closes[-1]] * (steps - len(closes))  # hold the last value if shorter
            out[:, j] = np.array(closes, dtype=float) / float(doc["last_actual_close"])
        return out

    lstm_growth = growth_paths(lstm) @ weights
    arima_growth = growth_paths(arima) @ weights

    # Per-stock standard deviation (fraction of price) at each step.
    returns = _returns_matrix(tickers, lookback_days=CORRELATION_DAYS).reindex(columns=tickers)
    daily_sd = returns.std().fillna(0.0).to_numpy(copy=True)
    k = np.arange(1, steps + 1)[:, None]
    sd = daily_sd[None, :] * np.sqrt(k)  # fallback: past-year volatility
    for j, t in enumerate(tickers):
        doc = arima.get(t)
        if not doc:
            continue
        half = [((p.get("upper_95") or 0) - (p.get("lower_95") or 0)) / 2 for p in doc["forecast"]][:steps]
        half += [half[-1]] * (steps - len(half))
        sd[:, j] = np.array(half, dtype=float) / Z95 / float(doc["last_actual_close"])

    corr = returns.corr().fillna(0.0).to_numpy(copy=True)
    np.fill_diagonal(corr, 1.0)
    v = sd * weights[None, :]
    portfolio_sd = np.sqrt(np.maximum(np.einsum("ki,ij,kj->k", v, corr, v), 0.0))
    lower, upper = arima_growth - Z95 * portfolio_sd, arima_growth + Z95 * portfolio_sd

    r = lambda a: [round(float(x), 6) for x in a]  # noqa: E731
    horizons = {
        name: {"lstm": float(lstm_growth[d - 1]), "arima": float(arima_growth[d - 1]),
               "lower": float(lower[d - 1]), "upper": float(upper[d - 1]), "date": dates[d - 1]}
        for name, d in HORIZONS.items() if d <= steps
    }
    return {
        "dates": dates,
        "lstm": r(lstm_growth),
        "arima": r(arima_growth),
        "lower": r(lower),
        "upper": r(upper),
        "steps": steps,
        "horizons": horizons,
        "missing": {"lstm": [t for t in tickers if t not in lstm], "arima": [t for t in tickers if t not in arima]},
        "data_end": reference.get("data_end"),
    }
