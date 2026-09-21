"""Train a PPO agent (stable-baselines3) on a ``PortfolioEnv`` built from
historical returns pulled out of ArangoDB, then turn the learned policy into
a concrete recommended allocation.
"""

import os
import uuid

import numpy as np
from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import BaseCallback

from ..config import RL_MODELS_DIR
from ..db.arango_client import get_db
from ..extensions import socketio
from ..rl.portfolio_env import PortfolioEnv
from .portfolio_service import compute_metrics
from .portfolio_service import _returns_matrix as returns_matrix

MIN_HISTORY_DAYS = 120


class SocketIOProgressCallback(BaseCallback):
    """Pushes training progress to any browser client that joined
    ``room`` (the Celery task id), roughly every 5% of total_timesteps.

    Also mirrors the same progress into the Celery task's own state via
    ``task.update_state`` when a bound task is given -- the frontend's poll
    fallback (`/api/rl/status`, racing alongside the socket listener the
    same way the import/prediction flows do) reads that state directly, and
    without this it would keep re-reading the one-time, completed/total
    -less snapshot `train_rl_portfolio` sets before training starts."""

    def __init__(self, room: str, total_timesteps: int, event: str = "rl_progress", task=None):
        super().__init__()
        self.room = room
        self.total_timesteps = total_timesteps
        self.event = event
        self.task = task
        self._step_interval = max(1, total_timesteps // 20)

    def _on_step(self) -> bool:
        if self.num_timesteps % self._step_interval == 0 or self.num_timesteps >= self.total_timesteps:
            progress = {"stage": "training", "completed": self.num_timesteps, "total": self.total_timesteps}
            socketio.emit(self.event, progress, room=self.room)
            if self.task is not None:
                self.task.update_state(state="PROGRESS", meta=progress)
        return True


def default_universe(n: int = 30) -> list[str]:
    """Top-N tickers by market cap, used when the caller doesn't pick a universe."""
    db = get_db()
    cursor = db.aql.execute(
        """
        FOR s IN stock_stats
            FILTER s.market_cap != null
            SORT s.market_cap DESC
            LIMIT @n
            RETURN s._key
        """,
        bind_vars={"n": n},
    )
    return list(cursor)


def rank_by_trend_consistency(tickers: list[str], lookback_days: int = 252) -> list[dict]:
    """Score each ticker by how closely its *past one year* of price action
    hugs a straight upward line -- fit an OLS trend line to cumulative
    log-return (i.e. log price) over the lookback window (defaults to 252
    trading days, ~1 year), then rank by the Kestner K-ratio:
    trend slope divided by the standard error of that slope. A steep line
    with tightly-clustered residuals scores highest; a choppy path that's
    still net positive scores low, because its residuals are large relative
    to the slope. A ticker whose fitted trend isn't upward at all (slope <=
    0) is excluded outright -- "low risk" here specifically means "almost a
    straight line up", not just "ends higher than it started".

    Returns every qualifying ticker, best first; the caller decides how
    many to keep. Raises ValueError if none of `tickers` has enough price
    history for the requested window."""
    returns_df = returns_matrix(tickers, lookback_days=lookback_days)
    # Require most of the requested window to actually be present (a few
    # missing days from holidays/gaps is fine) -- unlike the fixed
    # `MIN_HISTORY_DAYS` bar `train_and_recommend` uses for its much longer
    # default lookback, this must scale down for a short window (e.g. a
    # 3-month/63-day trend check), or nothing would ever pass a fixed
    # 120-day bar.
    min_days = max(3, int(lookback_days * 0.9))
    returns_df = returns_df.dropna(axis=1, thresh=min_days)
    if returns_df.empty:
        raise ValueError("Not enough tickers with sufficient price history to rank")

    scored = []
    for ticker in returns_df.columns:
        series = returns_df[ticker].dropna()
        n = len(series)
        if n < 3:
            continue

        log_price = np.log1p(series).cumsum().values  # cumulative log-return path
        t = np.arange(n, dtype=float)

        t_mean = t.mean()
        y_mean = log_price.mean()
        ss_t = np.sum((t - t_mean) ** 2)
        if ss_t == 0:
            continue

        slope = float(np.sum((t - t_mean) * (log_price - y_mean)) / ss_t)
        if slope <= 0:
            continue  # not trending up at all -- excluded, not merely penalized

        fitted = y_mean + slope * (t - t_mean)
        residuals = log_price - fitted
        ss_res = float(np.sum(residuals ** 2))
        ss_tot = float(np.sum((log_price - y_mean) ** 2))
        r_squared = 1.0 - ss_res / ss_tot if ss_tot > 0 else 0.0

        residual_std = (ss_res / (n - 2)) ** 0.5
        slope_std_err = residual_std / (ss_t ** 0.5)
        # A near-perfect line has ~zero residual scatter, i.e. slope_std_err
        # -> 0 -- treat that as an extremely high (not infinite/unserializable) score.
        k_ratio = slope / slope_std_err if slope_std_err > 0 else slope * 1e6

        scored.append({
            "ticker": ticker,
            "k_ratio": round(k_ratio, 2),
            "trend_fit_r2": round(r_squared, 4),
            "implied_annual_return": round(float(np.expm1(slope * 252)), 4),
        })

    scored.sort(key=lambda r: r["k_ratio"], reverse=True)
    return scored


def select_subset_by_trend_consistency(tickers: list[str], subset_size: int, lookback_days: int = 252) -> list[dict]:
    """The top `subset_size` tickers from `rank_by_trend_consistency`,
    clamped to at least 2 (the minimum `train_and_recommend` needs) and at
    most however many actually had an upward, scorable trend."""
    ranked = rank_by_trend_consistency(tickers, lookback_days=lookback_days)
    if len(ranked) < 2:
        raise ValueError("Fewer than 2 tickers in this universe have an upward price trend to select from")
    size = max(2, min(subset_size, len(ranked)))
    return ranked[:size]


def train_and_recommend(
    universe: list[str] | None = None,
    risk_aversion: float = 1.0,
    timesteps: int = 50_000,
    window: int = 30,
    progress_room: str | None = None,
    progress_task=None,
) -> dict:
    tickers = universe or default_universe()
    if len(tickers) < 2:
        raise ValueError("Need at least 2 tickers to build a portfolio")

    returns_df = returns_matrix(tickers, lookback_days=756)  # ~3 trading years, capped by what's stored
    returns_df = returns_df.dropna(axis=1, thresh=MIN_HISTORY_DAYS)
    if returns_df.shape[1] < 2:
        raise ValueError("Not enough tickers with sufficient price history to train on")
    returns_df = returns_df.fillna(0.0)

    if returns_df.shape[0] <= window + 10:
        raise ValueError(
            f"Not enough historical days ({returns_df.shape[0]}) for window={window}; import more history first"
        )

    used_tickers = list(returns_df.columns)
    returns = returns_df.values

    env = PortfolioEnv(returns, window=window, risk_aversion=risk_aversion)
    model = PPO("MlpPolicy", env, verbose=0)

    callback = SocketIOProgressCallback(progress_room, timesteps, task=progress_task) if progress_room else None
    model.learn(total_timesteps=timesteps, callback=callback)

    # Apply the learned policy to the most recent window to get today's recommendation.
    final_obs = env.reset()[0]
    final_obs[: window * len(used_tickers)] = returns[-window:].flatten()
    action, _ = model.predict(final_obs, deterministic=True)
    weights = PortfolioEnv.softmax(np.asarray(action, dtype=np.float64))

    holdings = [{"ticker": ticker, "weight": float(weight)} for ticker, weight in zip(used_tickers, weights)]
    metrics = compute_metrics(holdings)

    run_id = str(uuid.uuid4())
    os.makedirs(RL_MODELS_DIR, exist_ok=True)
    model_path = os.path.join(RL_MODELS_DIR, f"{run_id}.zip")
    model.save(model_path)

    return {
        "run_id": run_id,
        "tickers": used_tickers,
        "holdings": holdings,
        "metrics": metrics,
        "model_path": model_path,
        "hyperparams": {"algorithm": "PPO", "timesteps": timesteps, "risk_aversion": risk_aversion, "window": window},
    }
