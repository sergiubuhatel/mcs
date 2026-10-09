"""Per-ticker closing-price forecast with a classical ARIMA(p, d, q) model,
fitted on the daily closes already stored in `stock_prices`.

The statistical counterpart of the LSTM in `lstm_service.py`: same inputs,
same 80/20 chronological hold-out (RMSE/MAE) and same forecast output shape,
so the two forecasts can be compared side by side. Unless an explicit order
is given, (p, q) is picked by AIC over a small grid on the training split.
"""

import itertools
import os
import pickle
import warnings
from datetime import datetime, timedelta, timezone

import numpy as np
from statsmodels.tools.sm_exceptions import ConvergenceWarning
from statsmodels.tsa.arima.model import ARIMA

from ..config import RL_MODELS_DIR
from .lstm_service import DEFAULT_LOOKBACK_DAYS, MIN_HISTORY_DAYS, _load_closes, split_index


def _fit(series: np.ndarray, order: tuple[int, int, int]):
    with warnings.catch_warnings():
        # Non-convergence / non-invertible starting params are routine on
        # price series; the fit is still usable and AIC penalizes bad ones.
        warnings.simplefilter("ignore", ConvergenceWarning)
        warnings.simplefilter("ignore", UserWarning)
        return ARIMA(series, order=order).fit()


def _select_order(train: np.ndarray, d: int, max_p: int, max_q: int, on_step=None):
    candidates = list(itertools.product(range(max_p + 1), range(max_q + 1)))
    best_order, best_aic = None, np.inf
    for i, (p, q) in enumerate(candidates, start=1):
        try:
            aic = float(_fit(train, (p, d, q)).aic)
        except Exception:  # noqa: BLE001 - a non-estimable order is just skipped
            aic = np.inf
        if aic < best_aic:
            best_order, best_aic = (p, d, q), aic
        if on_step:
            on_step(i, len(candidates), (p, d, q), aic, best_order)
    if best_order is None:
        raise ValueError("No ARIMA order could be fitted to this price history")
    return best_order


def train_and_predict(
    ticker: str,
    order: tuple[int, int, int] | None = None,
    d: int = 1,
    max_p: int = 3,
    max_q: int = 3,
    lookback_days: int | None = DEFAULT_LOOKBACK_DAYS,
    forecast_days: int = 7,
    on_step=None,
) -> dict:
    """`order=None` searches p in [0, max_p], q in [0, max_q] (d fixed) by AIC.
    `lookback_days` keeps only the most recent closes (None = full history):
    ARIMA assumes a stable process, which 15 years of prices are not. The
    default window and the test split are shared with the LSTM."""
    ticker = ticker.upper()
    dates, closes = _load_closes(ticker)
    if lookback_days:
        dates, closes = dates[-lookback_days:], closes[-lookback_days:]
    if len(closes) < MIN_HISTORY_DAYS:
        raise ValueError(f"Not enough price history for '{ticker}' ({len(closes)} days) to fit an ARIMA model")

    series = closes.astype(np.float64)
    split = split_index(len(series))
    train, test = series[:split], series[split:]

    if order is None:
        order = _select_order(train, d, max_p, max_q, on_step=on_step)
    else:
        order = tuple(order)
        if on_step:
            on_step(1, 1, order, None, order)

    # Hold-out: parameters estimated on train only, then one-step-ahead
    # predictions over the test span (each step conditions on the actual
    # previous closes, like the LSTM's sliding windows).
    train_fit = _fit(train, order)
    test_pred = train_fit.append(test, refit=False).predict(start=split, end=len(series) - 1)
    rmse = float(np.sqrt(np.mean((test_pred - test) ** 2)))
    mae = float(np.mean(np.abs(test_pred - test)))

    # Final model on all retained history for the forward forecast.
    final_fit = _fit(series, order)
    fc = final_fit.get_forecast(steps=forecast_days)
    forecast_prices = np.asarray(fc.predicted_mean).tolist()
    conf = np.asarray(fc.conf_int(alpha=0.05))

    last_date = datetime.strptime(dates[-1], "%Y-%m-%d")
    forecast_dates = []
    day = last_date
    while len(forecast_dates) < forecast_days:
        day = day + timedelta(days=1)
        if day.weekday() < 5:  # skip weekends
            forecast_dates.append(day.strftime("%Y-%m-%d"))

    os.makedirs(RL_MODELS_DIR, exist_ok=True)
    model_path = os.path.join(RL_MODELS_DIR, f"arima_{ticker}.pkl")
    with open(model_path, "wb") as fh:
        pickle.dump({"order": order, "params": final_fit.params.tolist(), "last_date": dates[-1]}, fh)

    last_actual_close = float(closes[-1])
    forecast = []
    previous_close = last_actual_close
    for date, price, (lower, upper) in zip(forecast_dates, forecast_prices, conf):
        forecast.append({
            "date": date,
            "predicted_close": round(price, 2),
            "lower_95": round(float(lower), 2),
            "upper_95": round(float(upper), 2),
            "change_pct_from_last_close": round((price - last_actual_close) / last_actual_close * 100, 2),
            "change_pct_from_prior_day": round((price - previous_close) / previous_close * 100, 2),
        })
        previous_close = price

    return {
        "ticker": ticker,
        "order": list(order),
        "aic": float(final_fit.aic),
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "test_rmse": rmse,
        "test_mae": mae,
        "history_days": len(closes),
        "test_days": len(test),
        "last_actual_close": round(last_actual_close, 2),
        "forecast": forecast,
        "model_path": model_path,
    }
