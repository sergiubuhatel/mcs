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
"""

import numpy as np
import gymnasium as gym
from gymnasium import spaces


class PortfolioEnv(gym.Env):
    metadata = {"render_modes": []}

    def __init__(self, returns: np.ndarray, window: int = 30, risk_aversion: float = 1.0):
        """``returns``: 2D array of shape (T days, N assets) of fractional daily returns."""
        super().__init__()
        if returns.ndim != 2 or returns.shape[0] <= window:
            raise ValueError("returns must be a (T, N) array with T > window")

        self.returns = returns.astype(np.float32)
        self.n_assets = returns.shape[1]
        self.window = window
        self.risk_aversion = risk_aversion

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

        self._weights = weights.astype(np.float32)
        self._t += 1
        terminated = self._t >= len(self.returns)
        truncated = False
        obs = self._get_obs() if not terminated else np.zeros(self.observation_space.shape, dtype=np.float32)
        info = {"portfolio_return": portfolio_return, "volatility": volatility, "weights": weights.tolist()}
        return obs, reward, terminated, truncated, info
