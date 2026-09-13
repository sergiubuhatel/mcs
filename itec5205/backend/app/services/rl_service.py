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
    ``room`` (the Celery task id), roughly every 5% of total_timesteps."""

    def __init__(self, room: str, total_timesteps: int, event: str = "rl_progress"):
        super().__init__()
        self.room = room
        self.total_timesteps = total_timesteps
        self.event = event
        self._step_interval = max(1, total_timesteps // 20)

    def _on_step(self) -> bool:
        if self.num_timesteps % self._step_interval == 0 or self.num_timesteps >= self.total_timesteps:
            socketio.emit(
                self.event,
                {"stage": "training", "completed": self.num_timesteps, "total": self.total_timesteps},
                room=self.room,
            )
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


def train_and_recommend(
    universe: list[str] | None = None,
    risk_aversion: float = 1.0,
    timesteps: int = 50_000,
    window: int = 30,
    progress_room: str | None = None,
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

    callback = SocketIOProgressCallback(progress_room, timesteps) if progress_room else None
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
