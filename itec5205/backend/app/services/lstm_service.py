"""Per-ticker next-day closing-price prediction with a small PyTorch LSTM,
trained on the daily closes already stored in `stock_prices`.

This is a separate, complementary ML technique from the PPO portfolio
allocator in `rl_service.py`: a supervised time-series forecaster used for
per-stock price outlook, evaluated with held-out RMSE/MAE, rather than a
policy that outputs portfolio weights.
"""

import os
import time
from datetime import datetime, timedelta, timezone

import numpy as np
import torch
from torch import nn

from ..config import RL_MODELS_DIR
from ..db.arango_client import get_db
from .horizons import MAX_HORIZON_DAYS, backtest_bands, band_fields, horizon_points

MIN_HISTORY_DAYS = 120
# Shared by the LSTM and ARIMA forecasters AND the PPO portfolio agent so all
# three learn from the same window (10 years: trading days 2016-10-10..
# 2026-10-09 in the stored data) and are scored on the same held-out days.
# The Settings page's Forecast Defaults -> "Training days"
# (`forecast.training_days`) overrides it (see `training_days_setting`).
DEFAULT_LOOKBACK_DAYS = 2515
# Chronological train | validation | test split, the same for all three:
# test = the past year (252 trading days -- the "1Y" the app's metrics and the
# investor's limits are measured on), validation = the year before it, each at
# most 20% of a shorter history (LSTM: early stopping; PPO: best checkpoint;
# ARIMA picks its order by AIC on train + validation and needs none). With the
# 10-year window that is ~8 / 1 / 1 years -- the layout of TradeMaster
# (NeurIPS 2023: 10 years, last year test, the year before validation) and
# STHAN-SR / CI-STHPAN (AAAI: 756 / 252 / 237 days).
TEST_DAYS = 252
TEST_FRACTION = 0.2


def test_days(n_days: int) -> int:
    """Held-out test days in a window of `n_days`: the past year, or 20% of
    a history shorter than five years."""
    return min(TEST_DAYS, int(n_days * TEST_FRACTION))


def split_index(n_closes: int) -> int:
    """Index of the first held-out close: closes[split_index:] are the test days
    for all models (the past year, see `test_days`)."""
    return n_closes - test_days(n_closes)


def split_points(n_days: int) -> tuple[int, int]:
    """(validation start, test start) of a window of `n_days`: train =
    [0, validation start), validation = [validation start, test start),
    test = [test start, n_days)."""
    test_start = split_index(n_days)
    return test_start - test_days(test_start), test_start


CV_FOLDS = 5
CV_MIN_TRAIN_DAYS = 504


def expanding_folds(n_pre_test: int, folds: int = CV_FOLDS, fold_days: int = TEST_DAYS,
                    min_train: int = CV_MIN_TRAIN_DAYS) -> list[tuple[int, int]]:
    """Time-series (expanding-window, "rolling-origin") cross-validation over
    the days before the test period: the last `folds` blocks of `fold_days`
    each validate a model trained on everything before them, so a fold never
    trains on later days (no shuffling, unlike k-fold). Returns
    [(validation start, validation end), ...] oldest first; train of a fold =
    [0, validation start). Folds with less than `min_train` training days are
    dropped. With the 10-year window: 5 one-year folds, training on 4..8
    years. The test period is never touched."""
    out = []
    for k in range(folds, 0, -1):
        start, end = n_pre_test - k * fold_days, n_pre_test - (k - 1) * fold_days
        if start >= min_train:
            out.append((start, end))
    return out


def training_days_setting() -> int:
    """The shared training window in trading days: the saved Settings value
    (`forecast.training_days`), else `DEFAULT_LOOKBACK_DAYS`."""
    try:
        doc = get_db().collection("settings").get("app") or {}
        days = int(((doc.get("values") or {}).get("forecast") or {}).get("training_days"))
    except Exception:  # noqa: BLE001 - no settings collection/doc/value -> default
        return DEFAULT_LOOKBACK_DAYS
    return days if days >= MIN_HISTORY_DAYS else DEFAULT_LOOKBACK_DAYS


class LSTMPricePredictor(nn.Module):
    def __init__(self, hidden_size: int = 32, num_layers: int = 1):
        super().__init__()
        self.lstm = nn.LSTM(input_size=1, hidden_size=hidden_size, num_layers=num_layers, batch_first=True)
        self.head = nn.Linear(hidden_size, 1)

    def forward(self, x):
        out, _ = self.lstm(x)
        return self.head(out[:, -1, :])


def _load_closes(ticker: str) -> tuple[list[str], np.ndarray]:
    db = get_db()
    cursor = db.aql.execute(
        """
        FOR p IN stock_prices
            FILTER p.ticker == @ticker AND p.close != null
            SORT p.date ASC
            RETURN {date: p.date, close: p.close}
        """,
        bind_vars={"ticker": ticker},
    )
    rows = list(cursor)
    dates = [r["date"] for r in rows]
    closes = np.array([r["close"] for r in rows], dtype=np.float32)
    return dates, closes


def _make_sequences(scaled: np.ndarray, seq_len: int) -> tuple[np.ndarray, np.ndarray]:
    X, y = [], []
    for i in range(len(scaled) - seq_len):
        X.append(scaled[i : i + seq_len])
        y.append(scaled[i + seq_len])
    return np.array(X, dtype=np.float32), np.array(y, dtype=np.float32)


# Inputs/targets are expressed relative to the last close of each window
# (in percent), not as min-max-scaled absolute prices: a 15-year price series
# spans a huge range, so absolute scaling squeezes recent prices into a narrow
# band the network can't resolve, and the training split never sees the test
# price levels. Relative windows are on the same scale across the whole history.
RETURN_SCALE = 100.0


def _make_relative_sequences(closes: np.ndarray, seq_len: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """X[i] = closes[i:i+seq_len] / anchor - 1, y[i] = closes[i+seq_len] / anchor - 1,
    with anchor = closes[i+seq_len-1] (also returned, to map predictions back to prices)."""
    n = len(closes) - seq_len
    windows = np.stack([closes[i : i + seq_len] for i in range(n)])
    anchors = windows[:, -1]
    X = (windows / anchors[:, None] - 1.0) * RETURN_SCALE
    y = (closes[seq_len:] / anchors - 1.0) * RETURN_SCALE
    return X.astype(np.float32), y.astype(np.float32), anchors.astype(np.float64)


def train_and_predict(
    ticker: str,
    seq_len: int = 20,
    epochs: int = 100,
    hidden_size: int = 32,
    forecast_days: int = MAX_HORIZON_DAYS,
    lookback_days: int | None = DEFAULT_LOOKBACK_DAYS,
    batch_size: int = 64,
    patience: int = 10,
    seed: int = 42,
    on_epoch=None,
    history: tuple[list[str], np.ndarray] | None = None,
    save_model: bool = True,
) -> dict:
    """`epochs` is the maximum: training stops early once validation loss
    hasn't improved for `patience` epochs, and the best-validation weights are
    kept. A fixed `seed` (weight init + batch shuffling) makes retraining on
    the same data give the same forecast. `lookback_days` keeps only the most
    recent closes (None = full history), same as the ARIMA forecaster.
    `history=(dates, closes)` replaces the DB read (walk-forward backtests feed
    a truncated series); `save_model=False` skips writing the .pt file."""
    started = time.perf_counter()
    ticker = ticker.upper()
    dates, closes = history if history is not None else _load_closes(ticker)
    if lookback_days:
        dates, closes = dates[-lookback_days:], closes[-lookback_days:]
    if len(closes) < max(MIN_HISTORY_DAYS, seq_len + 30):
        raise ValueError(f"Not enough price history for '{ticker}' ({len(closes)} days) to train an LSTM")

    torch.manual_seed(seed)
    np.random.seed(seed)
    shuffle_gen = torch.Generator().manual_seed(seed)

    closes64 = closes.astype(np.float64)
    X, y, anchors = _make_relative_sequences(closes64, seq_len)
    # Chronological splits: train | validation (early stopping) | test (reported
    # RMSE/MAE). Sample i predicts closes[i + seq_len], so the test samples are
    # exactly those predicting closes[split_index:] -- the same days ARIMA is scored on.
    split = split_index(len(closes64)) - seq_len
    val_start = split_points(len(closes64))[0] - seq_len  # the year before the test
    X_t = torch.tensor(X).unsqueeze(-1)
    y_t = torch.tensor(y).unsqueeze(-1)
    X_train_t, y_train_t = X_t[:val_start], y_t[:val_start]
    X_val_t, y_val_t = X_t[val_start:split], y_t[val_start:split]
    X_test_t = X_t[split:]

    model = LSTMPricePredictor(hidden_size=hidden_size)
    optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
    loss_fn = nn.MSELoss()

    best_val, best_state, best_epoch, stale = float("inf"), None, 0, 0
    epochs_run = 0
    for epoch in range(1, epochs + 1):
        model.train()
        order = torch.randperm(len(X_train_t), generator=shuffle_gen)
        train_loss = 0.0
        for start in range(0, len(order), batch_size):
            idx = order[start : start + batch_size]
            optimizer.zero_grad()
            loss = loss_fn(model(X_train_t[idx]), y_train_t[idx])
            loss.backward()
            optimizer.step()
            train_loss += float(loss.item()) * len(idx)
        train_loss /= len(order)

        model.eval()
        with torch.no_grad():
            val_loss = float(loss_fn(model(X_val_t), y_val_t).item())
        epochs_run = epoch
        if val_loss < best_val - 1e-6:
            best_val, best_epoch, stale = val_loss, epoch, 0
            best_state = {k: v.clone() for k, v in model.state_dict().items()}
        else:
            stale += 1
        if on_epoch:
            on_epoch(epoch, epochs, train_loss, val_loss)
        if stale >= patience:
            break

    model.load_state_dict(best_state)
    model.eval()

    def _to_price(pred_rel, anchor):
        return anchor * (1.0 + pred_rel / RETURN_SCALE)

    if len(X_test_t):
        with torch.no_grad():
            test_rel = model(X_test_t).squeeze(-1).numpy().astype(np.float64)
        test_pred = _to_price(test_rel, anchors[split:])
        test_actual = closes64[seq_len + split :]
        rmse = float(np.sqrt(np.mean((test_pred - test_actual) ** 2)))
        mae = float(np.mean(np.abs(test_pred - test_actual)))
    else:
        rmse = mae = None

    def _recursive(windows: np.ndarray) -> np.ndarray:
        """Recursive multi-step forecast for a batch of price windows (B x
        seq_len): each predicted close is appended to its window and the
        window is re-normalized to its new last close. Returns B x forecast_days."""
        out = np.empty((len(windows), forecast_days))
        w = windows.copy()
        with torch.no_grad():
            for k in range(forecast_days):
                x = torch.tensor(((w / w[:, -1:] - 1.0) * RETURN_SCALE).astype(np.float32)).unsqueeze(-1)
                nxt = _to_price(model(x).squeeze(-1).numpy().astype(np.float64), w[:, -1])
                out[:, k] = nxt
                w = np.concatenate([w[:, 1:], nxt[:, None]], axis=1)
        return out

    forecast_prices = _recursive(closes64[-seq_len:][None, :])[0].tolist()

    # Multi-step backtest for the band: from every held-out day t, the full
    # forecast_days-ahead forecast from the seq_len closes before it.
    first = split_index(len(closes64))
    origins = np.arange(first, len(closes64))
    bands, band_info = {}, None
    if len(origins):
        predicted = _recursive(np.stack([closes64[t - seq_len : t] for t in origins]))
        actual = np.full_like(predicted, np.nan)
        for b, t in enumerate(origins):
            seen = closes64[t : t + forecast_days]
            actual[b, : len(seen)] = seen
        bands, band_info = backtest_bands(predicted, actual, forecast_prices)

    last_date = datetime.strptime(dates[-1], "%Y-%m-%d")
    forecast_dates = []
    d = last_date
    while len(forecast_dates) < forecast_days:
        d = d + timedelta(days=1)
        if d.weekday() < 5:  # skip weekends
            forecast_dates.append(d.strftime("%Y-%m-%d"))

    model_path = None
    if save_model:
        os.makedirs(RL_MODELS_DIR, exist_ok=True)
        model_path = os.path.join(RL_MODELS_DIR, f"lstm_{ticker}.pt")
        torch.save(
            {"state_dict": model.state_dict(), "input": "relative_window_pct", "seq_len": seq_len, "hidden_size": hidden_size},
            model_path,
        )

    last_actual_close = float(closes[-1])
    forecast = []
    previous_close = last_actual_close
    for i, (d, p) in enumerate(zip(forecast_dates, forecast_prices)):
        forecast.append({
            "date": d,
            "predicted_close": round(p, 2),
            # Bands (50-99%) measured from the backtest errors at this step.
            **band_fields(bands, i),
            # vs. the last actual close (cumulative move from today) and vs. the prior forecast day.
            "change_pct_from_last_close": round((p - last_actual_close) / last_actual_close * 100, 2),
            "change_pct_from_prior_day": round((p - previous_close) / previous_close * 100, 2),
        })
        previous_close = p

    return {
        "ticker": ticker,
        "seq_len": seq_len,
        "epochs": epochs,
        "epochs_run": epochs_run,
        "best_epoch": best_epoch,
        "seed": seed,
        "hidden_size": hidden_size,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "test_rmse": rmse,
        "test_mae": mae,
        "history_days": len(closes),
        "data_end": dates[-1],
        "train_seconds": round(time.perf_counter() - started, 3),
        "test_days": len(closes) - split_index(len(closes)),
        "last_actual_close": round(last_actual_close, 2),
        "forecast": forecast,
        "horizons": horizon_points(forecast, last_actual_close),
        "band": band_info,
        "model_path": model_path,
    }
