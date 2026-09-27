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
from .portfolio_service import compute_metrics, metrics_from_returns, returns_past_year
from .portfolio_service import _returns_matrix as returns_matrix

MIN_HISTORY_DAYS = 120
TRADING_DAYS_PER_YEAR = 252
# Positions below this optimal weight are dropped when the optimizer sizes
# the portfolio on its own.
MIN_SELECTED_WEIGHT = 0.005
# Trade-off points sampled along the efficient frontier.
FRONTIER_POINTS = 40
# Blend steps tried by `_enforce_constraints` (0 = pure RL weights).
BLEND_STEPS = [i / 20 for i in range(21)]


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


# Share of a year's trading days a ticker needs to be optimized over (see
# `optimize_selection`'s dropna threshold).
OPTIMIZER_HISTORY_DAYS = int(TRADING_DAYS_PER_YEAR * 0.9)


def price_history_days(tickers: list[str]) -> dict[str, int]:
    """How many daily returns are stored per ticker (0 if none) -- used to
    explain why a requested company was left out of a portfolio."""
    db = get_db()
    cursor = db.aql.execute(
        """
        FOR p IN stock_prices
            FILTER p.ticker IN @tickers AND p.percentage_change != null
            COLLECT ticker = p.ticker WITH COUNT INTO days
            RETURN {ticker, days}
        """,
        bind_vars={"tickers": tickers},
    )
    counts = {row["ticker"]: row["days"] for row in cursor}
    return {t: counts.get(t, 0) for t in tickers}


def excluded_for_history(
    requested: list[str], used: list[str], mode: str, optimized: bool, lookback_days: int
) -> list[dict]:
    """Requested tickers missing from `used` because they don't have enough
    price history for the steps this run went through -- the RL training
    minimum, plus the optimizer's ~1 year and/or the trend window's share.
    Companies the optimizer or trend filter dropped on merit aren't listed."""
    required = MIN_HISTORY_DAYS
    if optimized:
        required = max(required, OPTIMIZER_HISTORY_DAYS)
    if mode == "subset":
        required = max(required, int(lookback_days * 0.9))
    missing = [t for t in dict.fromkeys(requested) if t not in set(used)]
    if not missing:
        return []
    days = price_history_days(missing)
    return [
        {"ticker": t, "days": days[t], "required_days": required}
        for t in missing
        if days[t] < required
    ]


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


def constraint_violation(metrics: dict, max_volatility: float | None, min_return: float | None) -> float:
    """Total shortfall (in annualized fraction units) of `metrics` against
    the optional volatility ceiling / annual (compounded, past-year) return
    floor; 0 means both are met."""
    violation = 0.0
    if max_volatility is not None and metrics.get("expected_volatility") is not None:
        violation += max(0.0, metrics["expected_volatility"] - max_volatility)
    if min_return is not None and metrics.get("annual_return") is not None:
        violation += max(0.0, min_return - metrics["annual_return"])
    return violation


def _candidate_rank(metrics: dict, max_volatility: float | None, min_return: float | None) -> tuple:
    """Sort key, best first: feasible before infeasible, then smaller
    violation, then the objective the limits imply -- highest return under a
    volatility cap (with or without a return floor), lowest volatility above
    a return floor alone, highest Sharpe when there are no limits."""
    violation = constraint_violation(metrics, max_volatility, min_return)
    ret, vol, sharpe = metrics.get("annual_return"), metrics.get("expected_volatility"), metrics.get("sharpe_ratio")
    if max_volatility is not None:
        objective = -ret if ret is not None else float("inf")
    elif min_return is not None:
        objective = vol if vol is not None else float("inf")
    else:
        objective = -sharpe if sharpe is not None else float("inf")
    return (violation > 0, round(violation, 6), objective)


def _project_to_simplex(v: np.ndarray) -> np.ndarray:
    """Euclidean projection onto {w >= 0, sum(w) = 1} (long-only, fully invested)."""
    u = np.sort(v)[::-1]
    css = np.cumsum(u)
    rho = np.nonzero(u * np.arange(1, len(v) + 1) > css - 1)[0][-1]
    return np.maximum(v - (css[rho] - 1) / (rho + 1), 0.0)


def _efficient_frontier(returns: np.ndarray, points: int = FRONTIER_POINTS, iters: int = 500) -> list[np.ndarray]:
    """Long-only mean-variance frontier: for each trade-off t, minimize
    annual variance - t * annual return over the simplex with accelerated
    projected gradient (a convex QP, so this converges to the true optimum).
    t = 0 is the minimum-variance portfolio; large t tends to the single
    highest-return asset. Projection yields exact zeros, so the frontier
    portfolios are naturally sparse -- that's what sizes the selection."""
    n = returns.shape[1]
    mu = returns.mean(axis=0) * TRADING_DAYS_PER_YEAR
    cov = np.cov(returns, rowvar=False, ddof=0) * TRADING_DAYS_PER_YEAR
    step = 1.0 / (2.0 * max(np.linalg.eigvalsh(cov)[-1], 1e-12))

    frontier = []
    w = np.ones(n) / n
    for t in np.concatenate([[0.0], np.geomspace(1e-3, 1e3, points - 1)]):
        y, w_prev, momentum = w.copy(), w.copy(), 1.0
        for _ in range(iters):
            w_next = _project_to_simplex(y - step * (2.0 * cov @ y - t * mu))
            momentum_next = (1 + (1 + 4 * momentum**2) ** 0.5) / 2
            y = w_next + ((momentum - 1) / momentum_next) * (w_next - w_prev)
            w_prev, w, momentum = w_next, w_next, momentum_next
        frontier.append(w.copy())
    frontier.append(np.eye(n)[int(np.argmax(mu))])  # the max-return end point exactly
    return frontier


def optimize_selection(
    tickers: list[str],
    max_volatility: float | None = None,
    min_return: float | None = None,
    min_count: int | None = None,
    max_count: int | None = None,
) -> dict:
    """Choose which companies (and a baseline weighting of them) best meet
    the volatility ceiling / return floor over the past year, by walking the
    long-only efficient frontier of `tickers` and taking the best point per
    `_candidate_rank`. Companies weighted below MIN_SELECTED_WEIGHT are
    dropped, so the number of companies falls out of the optimization. If
    that number is outside [min_count, max_count], the nearest bound is
    used: every frontier point's top-N companies is tried as a candidate set
    (re-optimized over just those N) and the best set wins -- so a small
    count can land on e.g. the high-return end of the frontier instead of
    being stuck with the largest positions of the unrestricted solution.

    Returns {tickers, weights (dict), metrics, feasible}. `feasible` is False
    when no long-only mix of these companies meets the limits; the closest
    frontier point is returned then."""
    returns_df = returns_past_year(tickers)
    if not returns_df.empty:
        returns_df = returns_df.dropna(axis=1, thresh=int(len(returns_df) * 0.9)).fillna(0.0)
    if returns_df.shape[1] < 2:
        raise ValueError("Not enough tickers with a year of price history to optimize over")
    return _optimize(returns_df, max_volatility, min_return, min_count, max_count)


def _optimize(
    returns_df, max_volatility: float | None, min_return: float | None, min_count: int | None, max_count: int | None
) -> dict:
    """`optimize_selection` over an already-fetched returns DataFrame."""
    columns = list(returns_df.columns)
    returns = returns_df.values
    frontier = _efficient_frontier(returns)
    best = min(
        frontier, key=lambda w: _candidate_rank(metrics_from_returns(returns, w), max_volatility, min_return)
    )

    # Order by optimal weight, breaking ties (e.g. zero weights) by mean return.
    mean_returns = returns.mean(axis=0)
    order = sorted(range(len(columns)), key=lambda i: (-best[i], -mean_returns[i]))
    auto_size = sum(1 for i in order if best[i] >= MIN_SELECTED_WEIGHT)
    lo = max(2, min_count or 2)  # RL training needs at least 2 assets
    hi = max(lo, max_count) if max_count is not None else len(columns)
    size = min(max(auto_size, lo), hi, len(columns))
    keep = order[:size]
    if size != auto_size and size < len(columns):
        candidate_sets = {
            tuple(sorted(sorted(range(len(columns)), key=lambda i: (-w[i], -mean_returns[i]))[:size]))
            for w in frontier
        }
        # Re-solve over each set; min == max == size keeps all of its companies.
        results = [
            _optimize(returns_df.iloc[:, list(subset)], max_volatility, min_return, size, size)
            for subset in candidate_sets
        ]
        return min(results, key=lambda r: _candidate_rank(r["metrics"], max_volatility, min_return))

    # Floor at MIN_SELECTED_WEIGHT so a company kept to reach `min_count`
    # still gets a (small) position rather than a zero weight.
    weights = np.maximum(best[keep], MIN_SELECTED_WEIGHT)
    weights = weights / weights.sum()
    metrics = metrics_from_returns(returns[:, keep], weights)
    return {
        "tickers": [columns[i] for i in keep],
        "weights": {columns[i]: float(w) for i, w in zip(keep, weights)},
        "metrics": metrics,
        "feasible": constraint_violation(metrics, max_volatility, min_return) == 0,
    }


def select_universe(
    tickers: list[str],
    mode: str = "full",
    min_count: int | None = None,
    max_count: int | None = None,
    lookback_days: int = 252,
    max_volatility: float | None = None,
    min_return: float | None = None,
) -> dict:
    """Decide which companies the agent trains on.

    - "subset" mode first narrows `tickers` to those with an upward trend,
      ranked by K-ratio. With an exact count (min == max) and no limits, it
      keeps the top that-many by K-ratio, as it always has.
    - Otherwise any volatility/return limit or company-count bound (and
      always in subset mode) runs `optimize_selection` over the candidates --
      that is what drops companies and sizes the portfolio, within
      [min_count, max_count].
    - "full" mode with no limits and no count bounds trains on every ticker.

    Returns {tickers, selection (K-ratio rows, subset mode only), optimizer
    (optimize_selection's result, or None)}."""
    if min_count is not None and max_count is not None and min_count > max_count:
        raise ValueError(f"Min companies ({min_count}) is greater than max companies ({max_count})")
    constrained = max_volatility is not None or min_return is not None
    bounded = min_count is not None or max_count is not None
    candidates, ranked = tickers, None
    if mode == "subset":
        ranked = rank_by_trend_consistency(tickers, lookback_days=lookback_days)
        if len(ranked) < 2:
            raise ValueError("Fewer than 2 tickers in this universe have an upward price trend to select from")
        if min_count is not None and min_count == max_count and not constrained:
            chosen = ranked[: max(2, min(min_count, len(ranked)))]
            return {"tickers": [r["ticker"] for r in chosen], "selection": chosen, "optimizer": None}
        candidates = [r["ticker"] for r in ranked]
    elif not constrained and not bounded:
        return {"tickers": tickers, "selection": None, "optimizer": None}

    optimizer = optimize_selection(candidates, max_volatility, min_return, min_count, max_count)
    chosen = set(optimizer["tickers"])
    selection = [r for r in ranked if r["ticker"] in chosen] if ranked is not None else None
    return {"tickers": optimizer["tickers"], "selection": selection, "optimizer": optimizer}


def _enforce_constraints(
    tickers: list[str],
    weights: np.ndarray,
    max_volatility: float | None,
    min_return: float | None,
    anchor: dict[str, float] | None = None,
) -> tuple[np.ndarray, float]:
    """The env's constraint penalty is soft, so the learned weights can
    still miss the target. If they do, blend them toward an anchor
    allocation -- the optimizer's weights when given (feasible whenever the
    limits are reachable at all), plus equal and inverse-volatility weights --
    using the smallest blend that satisfies the constraints, so the result
    stays as close to the RL policy as possible. Returns (weights, blend)
    where blend is the anchor's share (0 = RL weights unchanged). If no
    blend is feasible, the closest one is returned."""
    returns_df = returns_past_year(tickers).reindex(columns=tickers).fillna(0.0)
    if returns_df.empty:
        return weights, 0.0
    returns = returns_df.values

    anchors = [np.ones(len(tickers)) / len(tickers)]
    stds = returns.std(axis=0)
    if np.all(stds > 0):
        inverse_vol = 1.0 / stds
        anchors.append(inverse_vol / inverse_vol.sum())
    if anchor:
        optimal = np.array([anchor.get(t, 0.0) for t in tickers])
        if optimal.sum() > 0:
            anchors.insert(0, optimal / optimal.sum())

    best_weights, best_blend = weights, 0.0
    best_key = _candidate_rank(metrics_from_returns(returns, weights), max_volatility, min_return)
    for blend in BLEND_STEPS[1:]:
        if not best_key[0]:
            break  # smallest feasible blend found
        for candidate_anchor in anchors:
            candidate = (1 - blend) * weights + blend * candidate_anchor
            key = _candidate_rank(metrics_from_returns(returns, candidate), max_volatility, min_return)
            if key < best_key:
                best_weights, best_blend, best_key = candidate, blend, key
    return best_weights, best_blend


def train_and_recommend(
    universe: list[str] | None = None,
    risk_aversion: float = 1.0,
    timesteps: int = 50_000,
    window: int = 30,
    progress_room: str | None = None,
    progress_task=None,
    max_volatility: float | None = None,
    min_return: float | None = None,
    anchor: dict[str, float] | None = None,
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

    env = PortfolioEnv(
        returns, window=window, risk_aversion=risk_aversion, max_volatility=max_volatility, min_return=min_return
    )
    model = PPO("MlpPolicy", env, verbose=0)

    callback = SocketIOProgressCallback(progress_room, timesteps, task=progress_task) if progress_room else None
    model.learn(total_timesteps=timesteps, callback=callback)

    # Apply the learned policy to the most recent window to get today's recommendation.
    final_obs = env.reset()[0]
    final_obs[: window * len(used_tickers)] = returns[-window:].flatten()
    action, _ = model.predict(final_obs, deterministic=True)
    weights = PortfolioEnv.softmax(np.asarray(action, dtype=np.float64))

    constrained = max_volatility is not None or min_return is not None
    blend = 0.0
    if constrained:
        weights, blend = _enforce_constraints(used_tickers, weights, max_volatility, min_return, anchor)

    holdings = [{"ticker": ticker, "weight": float(weight)} for ticker, weight in zip(used_tickers, weights)]
    metrics = compute_metrics(holdings)
    constraints = None
    if constrained:
        constraints = {
            "max_volatility": max_volatility,
            "min_return": min_return,
            "satisfied": constraint_violation(metrics, max_volatility, min_return) == 0,
            "blend": round(blend, 2),
        }

    run_id = str(uuid.uuid4())
    os.makedirs(RL_MODELS_DIR, exist_ok=True)
    model_path = os.path.join(RL_MODELS_DIR, f"{run_id}.zip")
    model.save(model_path)

    return {
        "run_id": run_id,
        "tickers": used_tickers,
        "holdings": holdings,
        "metrics": metrics,
        "constraints": constraints,
        "model_path": model_path,
        "hyperparams": {
            "algorithm": "PPO",
            "timesteps": timesteps,
            "risk_aversion": risk_aversion,
            "window": window,
            "max_volatility": max_volatility,
            "min_return": min_return,
        },
    }
