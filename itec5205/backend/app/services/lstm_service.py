"""Per-ticker next-day closing-price prediction with a small PyTorch LSTM,
trained on the daily closes already stored in `stock_prices`.

This is a separate, complementary ML technique from the PPO portfolio
allocator in `rl_service.py`: a supervised time-series forecaster used for
per-stock price outlook, evaluated with held-out RMSE/MAE, rather than a
policy that outputs portfolio weights.
"""

import os
from datetime import datetime, timedelta, timezone

import numpy as np
import torch
from torch import nn

from ..config import RL_MODELS_DIR
from ..db.arango_client import get_db

MIN_HISTORY_DAYS = 120


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


def train_and_predict(
    ticker: str,
    seq_len: int = 20,
    epochs: int = 30,
    hidden_size: int = 32,
    forecast_days: int = 7,
    on_epoch=None,
) -> dict:
    ticker = ticker.upper()
    dates, closes = _load_closes(ticker)
    if len(closes) < max(MIN_HISTORY_DAYS, seq_len + 30):
        raise ValueError(f"Not enough price history for '{ticker}' ({len(closes)} days) to train an LSTM")

    price_min, price_max = float(closes.min()), float(closes.max())
    span = (price_max - price_min) or 1.0
    scaled = (closes - price_min) / span

    X, y = _make_sequences(scaled, seq_len)
    split = int(len(X) * 0.8)
    X_train, y_train = X[:split], y[:split]
    X_test, y_test = X[split:], y[split:]

    X_train_t = torch.tensor(X_train).unsqueeze(-1)
    y_train_t = torch.tensor(y_train).unsqueeze(-1)
    X_test_t = torch.tensor(X_test).unsqueeze(-1)
    y_test_t = torch.tensor(y_test).unsqueeze(-1)

    model = LSTMPricePredictor(hidden_size=hidden_size)
    optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
    loss_fn = nn.MSELoss()

    model.train()
    for epoch in range(1, epochs + 1):
        optimizer.zero_grad()
        pred = model(X_train_t)
        loss = loss_fn(pred, y_train_t)
        loss.backward()
        optimizer.step()
        if on_epoch:
            on_epoch(epoch, epochs, float(loss.item()))

    model.eval()
    with torch.no_grad():
        test_pred_scaled = model(X_test_t).squeeze(-1).numpy() if len(X_test) else np.array([])

    def _unscale(arr):
        return arr * span + price_min

    if len(test_pred_scaled):
        test_pred = _unscale(test_pred_scaled)
        test_actual = _unscale(y_test)
        rmse = float(np.sqrt(np.mean((test_pred - test_actual) ** 2)))
        mae = float(np.mean(np.abs(test_pred - test_actual)))
    else:
        rmse = mae = None

    # Recursive multi-step forecast from the most recent `seq_len` closes.
    window = list(scaled[-seq_len:])
    forecast_scaled = []
    model.eval()
    with torch.no_grad():
        for _ in range(forecast_days):
            x = torch.tensor(np.array(window[-seq_len:], dtype=np.float32)).view(1, seq_len, 1)
            next_scaled = float(model(x).item())
            forecast_scaled.append(next_scaled)
            window.append(next_scaled)

    forecast_prices = _unscale(np.array(forecast_scaled)).tolist()
    last_date = datetime.strptime(dates[-1], "%Y-%m-%d")
    forecast_dates = []
    d = last_date
    while len(forecast_dates) < forecast_days:
        d = d + timedelta(days=1)
        if d.weekday() < 5:  # skip weekends
            forecast_dates.append(d.strftime("%Y-%m-%d"))

    os.makedirs(RL_MODELS_DIR, exist_ok=True)
    model_path = os.path.join(RL_MODELS_DIR, f"lstm_{ticker}.pt")
    torch.save(
        {"state_dict": model.state_dict(), "price_min": price_min, "price_max": price_max, "seq_len": seq_len, "hidden_size": hidden_size},
        model_path,
    )

    last_actual_close = float(closes[-1])
    forecast = []
    previous_close = last_actual_close
    for d, p in zip(forecast_dates, forecast_prices):
        forecast.append({
            "date": d,
            "predicted_close": round(p, 2),
            # vs. the last actual close (cumulative move from today) and vs. the prior forecast day.
            "change_pct_from_last_close": round((p - last_actual_close) / last_actual_close * 100, 2),
            "change_pct_from_prior_day": round((p - previous_close) / previous_close * 100, 2),
        })
        previous_close = p

    return {
        "ticker": ticker,
        "seq_len": seq_len,
        "epochs": epochs,
        "hidden_size": hidden_size,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "test_rmse": rmse,
        "test_mae": mae,
        "history_days": len(closes),
        "last_actual_close": round(last_actual_close, 2),
        "forecast": forecast,
        "model_path": model_path,
    }
