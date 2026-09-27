"""A Gymnasium environment for learning a low-risk/high-return portfolio
allocation over a fixed universe of assets, walking sequentially through
historical daily returns.

- **State**: the last `window` days of returns for every asset (flattened),
  concatenated with the current portfolio weights.
- **Action**: a real-valued vector of length N; softmax-normalized into
  long-only weights that sum to 1.
- **Reward**: portfolio daily return minus `risk_aversion` times the
  portfolio's trailing volatility over the same window -- a Sharpe-like
  signal that pushes the agent toward high return *and* low risk rather
  than either alone.
- **Constraints** (optional): an annualized `max_volatility` ceiling and/or
  `min_return` floor (compounded annual return). Each is checked against the
  trailing window in daily units -- vol / sqrt(252), and the daily log return
  log(1 + min_return) / 252 that compounds to it -- and any shortfall is subtracted from
  the reward, scaled by `constraint_penalty` -- a soft constraint that
  steers the policy toward the feasible region without making it the only
  signal.
"""

import numpy as np
import gymnasium as gym
from gymnasium import spaces

TRADING_DAYS_PER_YEAR = 252


class PortfolioEnv(gym.Env):
    metadata = {"render_modes": []}

    def __init__(
        self,
        returns: np.ndarray,
        window: int = 30,
        risk_aversion: float = 1.0,
        max_volatility: float | None = None,
        min_return: float | None = None,
        constraint_penalty: float = 10.0,
    ):
        """``returns``: 2D array of shape (T days, N assets) of fractional daily returns.
        ``max_volatility`` / ``min_return``: annualized fractions (0.25 = 25%), or None."""
        super().__init__()
        if returns.ndim != 2 or returns.shape[0] <= window:
            raise ValueError("returns must be a (T, N) array with T > window")

        self.returns = returns.astype(np.float32)
        self.n_assets = returns.shape[1]
        self.window = window
        self.risk_aversion = risk_aversion
        self.max_daily_vol = max_volatility / np.sqrt(TRADING_DAYS_PER_YEAR) if max_volatility is not None else None
        self.min_daily_log_return = (
            np.log1p(min_return) / TRADING_DAYS_PER_YEAR if min_return is not None and min_return > -1 else None
        )
        self.constraint_penalty = constraint_penalty

        obs_dim = self.window * self.n_assets + self.n_assets
        self.observation_space = spaces.Box(low=-np.inf, high=np.inf, shape=(obs_dim,), dtype=np.float32)
        self.action_space = spaces.Box(low=-10.0, high=10.0, shape=(self.n_assets,), dtype=np.float32)

        self._t = self.window
        self._weights = np.ones(self.n_assets, dtype=np.float32) / self.n_assets

    @staticmethod
    def softmax(x: np.ndarray) -> np.ndarray:
        x = x - np.max(x)
        e = np.exp(x)
        return e / e.sum()

    def _get_obs(self) -> np.ndarray:
        window_returns = self.returns[self._t - self.window : self._t].flatten()
        return np.concatenate([window_returns, self._weights]).astype(np.float32)

    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)
        self._t = self.window
        self._weights = np.ones(self.n_assets, dtype=np.float32) / self.n_assets
        return self._get_obs(), {}

    def step(self, action):
        weights = self.softmax(np.asarray(action, dtype=np.float64))
        day_returns = self.returns[self._t]
        portfolio_return = float(np.dot(weights, day_returns))

        recent_window = self.returns[max(0, self._t - self.window) : self._t]
        portfolio_history = recent_window @ weights
        volatility = float(np.std(portfolio_history)) if len(portfolio_history) > 1 else 0.0

        reward = portfolio_return - self.risk_aversion * volatility

        violation = 0.0
        if self.max_daily_vol is not None:
            violation += max(0.0, volatility - self.max_daily_vol)
        if self.min_daily_log_return is not None and len(portfolio_history) > 0:
            violation += max(0.0, self.min_daily_log_return - float(np.mean(np.log1p(portfolio_history))))
        reward -= self.constraint_penalty * violation

        self._weights = weights.astype(np.float32)
        self._t += 1
        terminated = self._t >= len(self.returns)
        truncated = False
        obs = self._get_obs() if not terminated else np.zeros(self.observation_space.shape, dtype=np.float32)
        info = {"portfolio_return": portfolio_return, "volatility": volatility, "weights": weights.tolist()}
        return obs, reward, terminated, truncated, info
