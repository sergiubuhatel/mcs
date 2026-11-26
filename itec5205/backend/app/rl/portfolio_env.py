"""A Gymnasium environment for learning a low-risk/high-return portfolio
allocation over a fixed universe of assets, walking sequentially through
historical daily returns.

- **State**: the last `window` days of returns for every asset (flattened),
  concatenated with the current portfolio weights.
- **Action**: a real-valued vector of length N; softmax-normalized into
  long-only weights that sum to 1. Assets not yet listed on a day (see
  `available`) get weight 0 that day -- the softmax runs over the listed
  ones only.
- **Reward**: portfolio daily return minus `risk_aversion` times the
  portfolio's trailing volatility over the same window -- a Sharpe-like
  signal that pushes the agent toward high return *and* low risk rather
  than either alone -- net of `transaction_cost` times the turnover
  sum(|w_new - w_old|), so the agent pays for every reallocation (the
  literature charges 0.1-0.25% per unit traded).
- **Constraints** (optional): an annualized `max_volatility` ceiling and/or
  `min_return` floor (compounded annual return). Each is checked against the
  trailing window in daily units -- vol / sqrt(252), and the daily log return
  log(1 + min_return) / 252 that compounds to it -- and any shortfall is subtracted from
  the reward, scaled by `constraint_penalty` -- a soft constraint that
  steers the policy toward the feasible region without making it the only
  signal.
- **Period**: an episode runs over days [start, end) of `returns` only, so
  the same array can drive a training, a validation and a test environment
  over consecutive, non-overlapping periods (the first `window` days before
  `start` are only read as state).
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
        transaction_cost: float = 0.0,
        available: np.ndarray | None = None,
        start: int | None = None,
        end: int | None = None,
    ):
        """``returns``: 2D array of shape (T days, N assets) of fractional daily returns.
        ``max_volatility`` / ``min_return``: annualized fractions (0.25 = 25%), or None.
        ``transaction_cost``: fraction of the traded value (0.001 = 0.1%).
        ``available``: optional (T, N) bool array, False before an asset's first
        trading day. ``start`` / ``end``: the episode's days (default: all after
        the first window)."""
        super().__init__()
        if returns.ndim != 2 or returns.shape[0] <= window:
            raise ValueError("returns must be a (T, N) array with T > window")

        self.returns = returns.astype(np.float32)
        self.n_assets = returns.shape[1]
        self.window = window
        self.available = None if available is None else np.asarray(available, dtype=bool)
        self.start = max(window, start if start is not None else window)
        self.end = min(len(returns), end if end is not None else len(returns))
        if self.end <= self.start:
            raise ValueError(f"empty episode: start={self.start}, end={self.end}")
        self.risk_aversion = risk_aversion
        self.max_daily_vol = max_volatility / np.sqrt(TRADING_DAYS_PER_YEAR) if max_volatility is not None else None
        self.min_daily_log_return = (
            np.log1p(min_return) / TRADING_DAYS_PER_YEAR if min_return is not None and min_return > -1 else None
        )
        self.constraint_penalty = constraint_penalty
        self.transaction_cost = transaction_cost

        obs_dim = self.window * self.n_assets + self.n_assets
        self.observation_space = spaces.Box(low=-np.inf, high=np.inf, shape=(obs_dim,), dtype=np.float32)
        self.action_space = spaces.Box(low=-10.0, high=10.0, shape=(self.n_assets,), dtype=np.float32)

        self._t = self.start
        self._weights = self.equal_weights(self.start)

    @staticmethod
    def softmax(x: np.ndarray) -> np.ndarray:
        x = x - np.max(x)
        e = np.exp(x)
        return e / e.sum()

    @staticmethod
    def masked_softmax(x: np.ndarray, mask: np.ndarray | None) -> np.ndarray:
        """Softmax over the assets where `mask` is True; 0 elsewhere (plain
        softmax when no mask, or when nothing is listed yet)."""
        x = np.asarray(x, dtype=np.float64)
        if mask is None or not mask.any():
            return PortfolioEnv.softmax(x)
        out = np.zeros_like(x)
        out[mask] = PortfolioEnv.softmax(x[mask])
        return out

    def mask(self, t: int) -> np.ndarray | None:
        return None if self.available is None else self.available[t]

    def equal_weights(self, t: int) -> np.ndarray:
        m = self.mask(t)
        if m is None or not m.any():
            return np.ones(self.n_assets, dtype=np.float32) / self.n_assets
        return (m / m.sum()).astype(np.float32)

    def observation(self, t: int, weights: np.ndarray) -> np.ndarray:
        """The state on day t: the `window` days before it, plus `weights`."""
        window_returns = self.returns[t - self.window : t].flatten()
        return np.concatenate([window_returns, weights]).astype(np.float32)

    def _get_obs(self) -> np.ndarray:
        return self.observation(self._t, self._weights)

    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)
        self._t = self.start
        self._weights = self.equal_weights(self.start)
        return self._get_obs(), {}

    def step(self, action):
        weights = self.masked_softmax(action, self.mask(self._t))
        day_returns = self.returns[self._t]
        portfolio_return = float(np.dot(weights, day_returns))

        recent_window = self.returns[max(0, self._t - self.window) : self._t]
        portfolio_history = recent_window @ weights
        volatility = float(np.std(portfolio_history)) if len(portfolio_history) > 1 else 0.0

        turnover = float(np.abs(weights - self._weights).sum())
        reward = portfolio_return - self.risk_aversion * volatility - self.transaction_cost * turnover

        violation = 0.0
        if self.max_daily_vol is not None:
            violation += max(0.0, volatility - self.max_daily_vol)
        if self.min_daily_log_return is not None and len(portfolio_history) > 0:
            violation += max(0.0, self.min_daily_log_return - float(np.mean(np.log1p(portfolio_history))))
        reward -= self.constraint_penalty * violation

        self._weights = weights.astype(np.float32)
        self._t += 1
        terminated = self._t >= self.end
        truncated = False
        obs = self._get_obs() if not terminated else np.zeros(self.observation_space.shape, dtype=np.float32)
        info = {"portfolio_return": portfolio_return, "volatility": volatility, "turnover": turnover,
                "weights": weights.tolist()}
        return obs, reward, terminated, truncated, info
