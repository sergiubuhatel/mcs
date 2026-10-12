"""Per-ticker closing-price forecast with a classical ARIMA(p, d, q) model,
fitted on the daily closes already stored in `stock_prices`.

The statistical counterpart of the LSTM in `lstm_service.py`: same inputs,
same 80/20 chronological hold-out (RMSE/MAE) and same forecast output shape,
so the two forecasts can be compared side by side. Unless an explicit order
is given, (p, q) and whether to include a drift term are picked by AIC over a
small grid on the training split. Drift matters for the 1-4 month horizons:
without it a d=1 model's multi-step forecast flattens to a constant, so it
could never call a direction months out.
"""

import itertools
import os
import pickle
import time
import warnings
from datetime import datetime, timedelta, timezone

import numpy as np
from statsmodels.tools.sm_exceptions import ConvergenceWarning
from statsmodels.tsa.arima.model import ARIMA

from ..config import RL_MODELS_DIR
from .horizons import MAX_HORIZON_DAYS, backtest_band, horizon_points
from .lstm_service import DEFAULT_LOOKBACK_DAYS, MIN_HISTORY_DAYS, _load_closes, split_index


def _trend_options(d: int) -> list[str]:
    # statsmodels: with d=1, trend "t" is a constant drift in the differences;
    # with d=0 the equivalent is a constant "c". "n" = no trend term.
    return ["n", "t"] if d == 1 else ["n", "c"]


def _fit(series: np.ndarray, order: tuple[int, int, int], trend: str = "n"):
    with warnings.catch_warnings():
        # Non-convergence / non-invertible starting params are routine on
        # price series; the fit is still usable and AIC penalizes bad ones.
        warnings.simplefilter("ignore", ConvergenceWarning)
        warnings.simplefilter("ignore", UserWarning)
        return ARIMA(series, order=order, trend=trend).fit()


def _select_order(train: np.ndarray, d: int, max_p: int, max_q: int, on_step=None):
    candidates = list(itertools.product(range(max_p + 1), range(max_q + 1), _trend_options(d)))
    best, best_aic = None, np.inf
    for i, (p, q, trend) in enumerate(candidates, start=1):
        try:
            aic = float(_fit(train, (p, d, q), trend).aic)
        except Exception:  # noqa: BLE001 - a non-estimable order is just skipped
            aic = np.inf
        if aic < best_aic:
            best, best_aic = ((p, d, q), trend), aic
        if on_step:
            on_step(i, len(candidates), (p, d, q), aic, best[0] if best else None)
    if best is None:
        raise ValueError("No ARIMA order could be fitted to this price history")
    return best


def train_and_predict(
    ticker: str,
    order: tuple[int, int, int] | None = None,
    d: int = 1,
    max_p: int = 3,
    max_q: int = 3,
    lookback_days: int | None = DEFAULT_LOOKBACK_DAYS,
    forecast_days: int = MAX_HORIZON_DAYS,
    trend: str | None = None,
    on_step=None,
    history: tuple[list[str], np.ndarray] | None = None,
    save_model: bool = True,
) -> dict:
    """`order=None` searches p in [0, max_p], q in [0, max_q] (d fixed) and
    drift on/off by AIC; with an explicit `order`, `trend` defaults to drift.
    `lookback_days` keeps only the most recent closes (None = full history):
    ARIMA assumes a stable process, which 15 years of prices are not. The
    default window and the test split are shared with the LSTM."""
    started = time.perf_counter()
    ticker = ticker.upper()
    # `history=(dates, closes)` replaces the DB read (walk-forward backtests).
    dates, closes = history if history is not None else _load_closes(ticker)
    if lookback_days:
        dates, closes = dates[-lookback_days:], closes[-lookback_days:]
    if len(closes) < MIN_HISTORY_DAYS:
        raise ValueError(f"Not enough price history for '{ticker}' ({len(closes)} days) to fit an ARIMA model")

    series = closes.astype(np.float64)
    split = split_index(len(series))
    train, test = series[:split], series[split:]

    if order is None:
        order, trend = _select_order(train, d, max_p, max_q, on_step=on_step)
    else:
        order = tuple(order)
        trend = trend or _trend_options(order[1])[1]
        if on_step:
            on_step(1, 1, order, None, order)

    # Hold-out: parameters estimated on train only, then one-step-ahead
    # predictions over the test span (each step conditions on the actual
    # previous closes, like the LSTM's sliding windows).
    train_fit = _fit(train, order, trend)
    held_out = train_fit.append(test, refit=False)
    test_pred = held_out.predict(start=split, end=len(series) - 1)
    rmse = float(np.sqrt(np.mean((test_pred - test) ** 2)))
    mae = float(np.mean(np.abs(test_pred - test)))

    # Multi-step backtest for the band: from every test day, the full
    # forecast_days-ahead forecast using only the closes before it (dynamic
    # prediction = same as refitting the filter on series[:t] and forecasting).
    predicted = np.full((len(test), forecast_days), np.nan)
    actual = np.full((len(test), forecast_days), np.nan)
    for b, t in enumerate(range(split, len(series))):
        end = min(t + forecast_days, len(series)) - 1
        predicted[b, : end - t + 1] = np.asarray(held_out.predict(start=t, end=end, dynamic=True))
        actual[b, : end - t + 1] = series[t : end + 1]

    # Final model on all retained history for the forward forecast.
    final_fit = _fit(series, order, trend)
    fc = final_fit.get_forecast(steps=forecast_days)
    forecast_prices = np.asarray(fc.predicted_mean).tolist()
    conf = np.asarray(fc.conf_int(alpha=0.05))
    band_lower, band_upper, band_info = backtest_band(predicted, actual, forecast_prices)

    last_date = datetime.strptime(dates[-1], "%Y-%m-%d")
    forecast_dates = []
    day = last_date
    while len(forecast_dates) < forecast_days:
        day = day + timedelta(days=1)
        if day.weekday() < 5:  # skip weekends
            forecast_dates.append(day.strftime("%Y-%m-%d"))

    model_path = None
    if save_model:
        os.makedirs(RL_MODELS_DIR, exist_ok=True)
        model_path = os.path.join(RL_MODELS_DIR, f"arima_{ticker}.pkl")
        with open(model_path, "wb") as fh:
            pickle.dump({"order": order, "trend": trend, "params": final_fit.params.tolist(), "last_date": dates[-1]}, fh)

    last_actual_close = float(closes[-1])
    forecast = []
    previous_close = last_actual_close
    for i, (date, price, (lower, upper)) in enumerate(zip(forecast_dates, forecast_prices, conf)):
        forecast.append({
            "date": date,
            "predicted_close": round(price, 2),
            # ARIMA's own (model-based) 95% interval ...
            "lower_95": round(float(lower), 2),
            "upper_95": round(float(upper), 2),
            # ... and the one measured from its backtest errors at this step.
            **({"band_low": round(band_lower[i], 2), "band_high": round(band_upper[i], 2)} if band_lower else {}),
            "change_pct_from_last_close": round((price - last_actual_close) / last_actual_close * 100, 2),
            "change_pct_from_prior_day": round((price - previous_close) / previous_close * 100, 2),
        })
        previous_close = price

    return {
        "ticker": ticker,
        "order": list(order),
        "trend": trend,
        "drift": trend in ("t", "c"),
        "aic": float(final_fit.aic),
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "test_rmse": rmse,
        "test_mae": mae,
        "history_days": len(closes),
        "data_end": dates[-1],
        "train_seconds": round(time.perf_counter() - started, 3),
        "test_days": len(test),
        "last_actual_close": round(last_actual_close, 2),
        "forecast": forecast,
        "horizons": horizon_points(forecast, last_actual_close),
        "band": band_info,
        "model_path": model_path,
    }
