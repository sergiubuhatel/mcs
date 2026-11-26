"""Train a PPO agent (stable-baselines3) on a ``PortfolioEnv`` built from
historical returns pulled out of ArangoDB, then turn the learned policy into
a concrete recommended allocation.

The agent learns from the same window and the same chronological split as
the LSTM and ARIMA forecasters (`lstm_service.split_points`): it trains on
the first part, the policy is scored on the validation period after every
PPO rollout and the best checkpoint is kept (the counterpart of the LSTM's
early stopping), and that policy is then tested on the past year -- held
quarterly against equal weights on the same companies with the same cost --
which gives an out-of-sample RL premium. Today's allocation is the chosen
policy applied to the latest window, as the LSTM's forecast is its chosen
network applied to the latest closes.
"""

import copy
import os
import uuid

import numpy as np
from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import BaseCallback

from ..config import RL_MODELS_DIR
from ..db.arango_client import get_db
from ..extensions import socketio
from ..rl.portfolio_env import PortfolioEnv
from .lstm_service import expanding_folds, split_points, training_days_setting
from .portfolio_service import compute_metrics, metrics_from_returns, returns_past_year
from .portfolio_service import _returns_matrix as returns_matrix

MIN_HISTORY_DAYS = 120
TRADING_DAYS_PER_YEAR = 252
# Positions below this optimal weight are dropped when the optimizer sizes
# the portfolio on its own.
MIN_SELECTED_WEIGHT = 0.005
# Trade-off points sampled along the efficient frontier, and the number of
# interpolation steps added between each neighbouring pair of them.
FRONTIER_POINTS = 40
INTERPOLATION_STEPS = 10
# Cost charged in the RL reward per unit of turnover (0.1% of the traded
# value), the common choice in the RL portfolio literature.
TRANSACTION_COST = 0.001

# Blend steps tried by `_enforce_constraints` (0 = pure RL weights).
BLEND_STEPS = [i / 20 for i in range(21)]
# Fixed PPO seed (network init + sampling), like the LSTM's, so training on
# the same data gives the same portfolio.
DEFAULT_SEED = 42
# The test holds each allocation for a quarter, then rebalances (as the
# Stage 4 walk-forward evaluation does).
TEST_REBALANCE_DAYS = 63


class ValidationCheckpoint(BaseCallback):
    """After every PPO rollout (and once more after training), runs the
    current deterministic policy through the validation period and keeps a
    copy of the policy with the best mean daily reward -- the same objective
    it is trained on, measured on days it never trained on."""

    def __init__(self, val_env: PortfolioEnv):
        super().__init__()
        self.val_env = val_env
        self.best_score = -np.inf
        self.best_step = 0
        self.best_state = None
        self.evaluations = 0

    def _on_step(self) -> bool:
        return True

    def _on_rollout_end(self) -> None:
        self.evaluate()

    def evaluate(self) -> None:
        obs, _ = self.val_env.reset()
        rewards, done = [], False
        while not done:
            action, _ = self.model.predict(obs, deterministic=True)
            obs, reward, done, _, _ = self.val_env.step(action)
            rewards.append(reward)
        score = float(np.mean(rewards))
        self.evaluations += 1
        if score > self.best_score:
            self.best_score, self.best_step = score, int(self.num_timesteps)
            self.best_state = copy.deepcopy(self.model.policy.state_dict())


def _series_metrics(daily: np.ndarray) -> dict:
    """Annualized return (compounded), volatility, Sharpe ratio (no risk-free
    rate, as everywhere in the app) and max drawdown of daily net returns."""
    daily = np.asarray(daily, dtype=np.float64)
    growth = np.cumprod(1 + daily)
    years = len(daily) / TRADING_DAYS_PER_YEAR
    std = daily.std()
    peak = np.maximum.accumulate(np.concatenate([[1.0], growth]))
    return {
        "total_return": round(float(growth[-1] - 1), 4),
        "annual_return": round(float(growth[-1] ** (1 / years) - 1), 4) if years > 0 else None,
        "volatility": round(float(std * np.sqrt(TRADING_DAYS_PER_YEAR)), 4),
        "sharpe_ratio": round(float(daily.mean() / std * np.sqrt(TRADING_DAYS_PER_YEAR)), 3) if std > 0 else None,
        "max_drawdown": round(float((np.concatenate([[1.0], growth]) / peak - 1).min()), 4),
    }


def _held_test(returns: np.ndarray, start: int, end: int, target_at, cost: float) -> dict:
    """Days [start, end): every TEST_REBALANCE_DAYS the portfolio is reset to
    `target_at(t)` (decided with data before day t) and then drifts with
    prices; each rebalance pays `cost` x turnover (the first buys from cash,
    turnover 1)."""
    held, daily = None, []
    for t in range(start, end):
        turnover = 0.0
        if (t - start) % TEST_REBALANCE_DAYS == 0:
            target = np.asarray(target_at(t, held), dtype=np.float64)
            turnover = 1.0 if held is None else float(np.abs(target - held).sum())
            held = target
        r = float(held @ returns[t])
        daily.append(r - cost * turnover)
        held = held * (1 + returns[t])
        held = held / held.sum() if held.sum() > 0 else held
    return _series_metrics(np.array(daily))


def _policy_fn(model, env: PortfolioEnv):
    """target_at(t, held) for `_held_test`: the deterministic policy's
    allocation on day t, from the window before t and the current holdings."""
    def policy(t, held):
        weights = env.equal_weights(t) if held is None else held
        action, _ = model.predict(env.observation(t, weights.astype(np.float32)), deterministic=True)
        return PortfolioEnv.masked_softmax(action, env.mask(t))
    return policy


def _test_report(model, env: PortfolioEnv, returns: np.ndarray, start: int, end: int, cost: float) -> dict:
    """The chosen policy vs. equal weights on the same companies over the
    test period, both held quarterly with the same cost. RL premium = relative
    Sharpe gain, (SR_RL - SR_EW) / |SR_EW|."""
    rl = _held_test(returns, start, end, _policy_fn(model, env), cost)
    ew = _held_test(returns, start, end, lambda t, _held: env.equal_weights(t), cost)
    premium = None
    if rl["sharpe_ratio"] is not None and ew["sharpe_ratio"]:
        premium = round((rl["sharpe_ratio"] - ew["sharpe_ratio"]) / abs(ew["sharpe_ratio"]), 4)
    return {"rl": rl, "equal_weight": ew, "rl_premium": premium, "rebalance_days": TEST_REBALANCE_DAYS}


# Risk-aversion values compared by cross-validation (plus the requested one).
CV_RISK_AVERSIONS = (0.5, 1.0, 2.0)


def cross_validate_setting() -> bool:
    """Settings -> Portfolio Defaults -> "Cross-validate risk aversion"
    (`portfolio.cross_validate`), on unless switched off."""
    try:
        doc = get_db().collection("settings").get("app") or {}
        value = ((doc.get("values") or {}).get("portfolio") or {}).get("cross_validate")
    except Exception:  # noqa: BLE001 - no settings -> default
        return True
    return True if value is None else bool(value)


def _cross_validate(make_env, returns: np.ndarray, dates: list[str], window: int, n_pre_test: int,
                    candidates: list[float], timesteps: int, seed: int, cost: float, progress=None) -> dict | None:
    """Expanding-window cross-validation of the risk aversion over the days
    before the test period (`expanding_folds`: one-year validation folds, each
    trained on everything before it). Every candidate is trained once per
    fold and its policy held quarterly through the fold's validation year;
    the candidate with the best mean Sharpe ratio over the folds wins (ties
    keep the earlier candidate). Sharpe, not the reward, is compared because
    the reward itself depends on the risk aversion. Equal weights per fold
    are reported for reference. None when fewer than 2 folds fit."""
    folds = expanding_folds(n_pre_test)
    folds = [(s, e) for s, e in folds if s - window >= 30]
    if len(folds) < 2:
        return None
    ew = [_held_test(returns, s, e, lambda t, _h, env=make_env(s, e, 1.0): env.equal_weights(t), cost)["sharpe_ratio"]
          for s, e in folds]
    rows, done = [], 0
    for ra in candidates:
        per_fold = []
        for s, e in folds:
            model = PPO("MlpPolicy", make_env(window, s, ra), verbose=0, seed=seed)
            model.learn(total_timesteps=timesteps, callback=progress(done) if progress else None)
            done += timesteps
            per_fold.append(_held_test(returns, s, e, _policy_fn(model, make_env(s, e, ra)), cost)["sharpe_ratio"])
        valid = [x for x in per_fold if x is not None]
        rows.append({"risk_aversion": ra, "per_fold": per_fold,
                     "mean_sharpe": round(float(np.mean(valid)), 3) if valid else None})
    best = max(rows, key=lambda r: -np.inf if r["mean_sharpe"] is None else r["mean_sharpe"])
    return {
        "method": "expanding window",
        "folds": [{"train": {"from": dates[window], "to": dates[s - 1], "days": s - window},
                   "validation": {"from": dates[s], "to": dates[e - 1], "days": e - s}} for s, e in folds],
        "candidates": rows,
        "equal_weight_sharpe": ew,
        "chosen_risk_aversion": best["risk_aversion"],
        "trainings": len(rows) * len(folds),
    }


class SocketIOProgressCallback(BaseCallback):
    """Pushes training progress to any browser client that joined
    ``room`` (the Celery task id), roughly every 5% of total_timesteps.

    Also mirrors the same progress into the Celery task's own state via
    ``task.update_state`` when a bound task is given -- the frontend's poll
    fallback (`/api/rl/status`, racing alongside the socket listener the
    same way the import/prediction flows do) reads that state directly, and
    without this it would keep re-reading the one-time, completed/total
    -less snapshot `train_rl_portfolio` sets before training starts."""

    def __init__(self, room: str, total_timesteps: int, event: str = "rl_progress", task=None,
                 offset: int = 0, grand_total: int | None = None, stage: str = "training"):
        """`offset` / `grand_total`: when one run trains several models
        (cross-validation, then the final one), progress counts steps over
        all of them."""
        super().__init__()
        self.room = room
        self.total_timesteps = total_timesteps
        self.event = event
        self.task = task
        self.offset = offset
        self.grand_total = grand_total or total_timesteps
        self.stage = stage
        self._step_interval = max(1, total_timesteps // 20)

    def _on_step(self) -> bool:
        if self.num_timesteps % self._step_interval == 0 or self.num_timesteps >= self.total_timesteps:
            progress = {"stage": self.stage, "completed": min(self.offset + self.num_timesteps, self.grand_total),
                        "total": self.grand_total}
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


def constraint_violation(
    metrics: dict, max_volatility: float | None, min_return: float | None, max_drawdown: float | None = None
) -> float:
    """Total shortfall (in fraction units) of `metrics` against the optional
    volatility ceiling / annual (compounded, past-year) return floor / max
    drawdown ceiling (worst past-year fall from a peak); 0 means all are met."""
    violation = 0.0
    if max_volatility is not None and metrics.get("expected_volatility") is not None:
        violation += max(0.0, metrics["expected_volatility"] - max_volatility)
    if min_return is not None and metrics.get("annual_return") is not None:
        violation += max(0.0, min_return - metrics["annual_return"])
    if max_drawdown is not None and metrics.get("max_drawdown") is not None:
        violation += max(0.0, metrics["max_drawdown"] - max_drawdown)
    return violation


def _candidate_rank(
    metrics: dict, max_volatility: float | None, min_return: float | None, max_drawdown: float | None = None
) -> tuple:
    """Sort key, best first: feasible before infeasible, then smaller
    violation, then the objective the limits imply -- highest return under a
    volatility or drawdown cap (with or without a return floor), lowest
    volatility above a return floor alone, highest Sharpe when there are no
    limits. Ties go to the smaller drawdown."""
    violation = constraint_violation(metrics, max_volatility, min_return, max_drawdown)
    ret, vol, sharpe = metrics.get("annual_return"), metrics.get("expected_volatility"), metrics.get("sharpe_ratio")
    if max_volatility is not None or max_drawdown is not None:
        objective = -ret if ret is not None else float("inf")
    elif min_return is not None:
        objective = vol if vol is not None else float("inf")
    else:
        objective = -sharpe if sharpe is not None else float("inf")
    dd = metrics.get("max_drawdown")
    return (violation > 0, round(violation, 6), objective, dd if dd is not None else float("inf"))


def _project_to_simplex(v: np.ndarray, total: float = 1.0) -> np.ndarray:
    """Euclidean projection onto {w >= 0, sum(w) = total} (long-only, fully invested)."""
    if total <= 0:
        return np.zeros_like(v)
    u = np.sort(v)[::-1]
    css = np.cumsum(u)
    rho = np.nonzero(u * np.arange(1, len(v) + 1) > css - total)[0][-1]
    return np.maximum(v - (css[rho] - total) / (rho + 1), 0.0)


def _required_floor(columns: list[str], required: list[str] | None) -> np.ndarray:
    """Per-company lower weight bound: MIN_SELECTED_WEIGHT for mandatory
    companies (so the optimizer can't drop them), 0 for the rest."""
    req = set(required or [])
    floor = np.array([MIN_SELECTED_WEIGHT if c in req else 0.0 for c in columns])
    return floor if floor.sum() < 1 else floor / floor.sum()  # (only with ~200 mandatory)


def _efficient_frontier(
    returns: np.ndarray, points: int = FRONTIER_POINTS, iters: int = 500, floor: np.ndarray | None = None
) -> list[np.ndarray]:
    """Long-only mean-variance frontier: for each trade-off t, minimize
    annual variance - t * annual return over the simplex with accelerated
    projected gradient (a convex QP, so this converges to the true optimum).
    t = 0 is the minimum-variance portfolio; large t tends to the single
    highest-return asset. Projection yields exact zeros, so the frontier
    portfolios are naturally sparse -- that's what sizes the selection.
    `floor` (optional) is a per-company minimum weight: w = floor + x with x
    on the simplex scaled to 1 - sum(floor), so the mandatory companies stay
    in every frontier portfolio."""
    n = returns.shape[1]
    floor = np.zeros(n) if floor is None else floor
    free = 1.0 - floor.sum()
    mu = returns.mean(axis=0) * TRADING_DAYS_PER_YEAR
    cov = np.cov(returns, rowvar=False, ddof=0) * TRADING_DAYS_PER_YEAR
    step = 1.0 / (2.0 * max(np.linalg.eigvalsh(cov)[-1], 1e-12))

    frontier = []
    w = np.ones(n) / n
    for t in np.concatenate([[0.0], np.geomspace(1e-3, 1e3, points - 1)]):
        y, w_prev, momentum = w.copy(), w.copy(), 1.0
        for _ in range(iters):
            w_next = floor + _project_to_simplex(y - step * (2.0 * cov @ y - t * mu) - floor, free)
            momentum_next = (1 + (1 + 4 * momentum**2) ** 0.5) / 2
            y = w_next + ((momentum - 1) / momentum_next) * (w_next - w_prev)
            w_prev, w, momentum = w_next, w_next, momentum_next
        frontier.append(w.copy())
    frontier.append(floor + free * np.eye(n)[int(np.argmax(mu))])  # the max-return end point exactly
    return frontier


def _drop_small_positions(w: np.ndarray, floor: np.ndarray | None = None) -> np.ndarray:
    """Zero out positions below MIN_SELECTED_WEIGHT (mandatory ones, floor > 0, are kept)."""
    keep = w >= MIN_SELECTED_WEIGHT if floor is None else (w >= MIN_SELECTED_WEIGHT) | (floor > 0)
    kept = np.where(keep, w, 0.0)
    return kept / kept.sum() if kept.sum() > 0 else w


def _interpolate_frontier(frontier: list[np.ndarray], steps: int = INTERPOLATION_STEPS) -> list[np.ndarray]:
    """The sampled frontier points can be far apart in risk/return (e.g. the
    minimum-variance point at 49% return and the next one at 114%), so a
    limit that falls between two of them would be reported as unreachable,
    or met with a lot of room to spare. Adding convex combinations of each
    pair of neighbouring points fills those gaps: a mix of two long-only,
    fully-invested portfolios is itself one."""
    dense = [frontier[0]]
    for a, b in zip(frontier, frontier[1:]):
        dense.extend((1 - k / steps) * a + (k / steps) * b for k in range(1, steps + 1))
    return dense


def optimize_selection(
    tickers: list[str],
    max_volatility: float | None = None,
    min_return: float | None = None,
    min_count: int | None = None,
    max_count: int | None = None,
    required: list[str] | None = None,
    max_drawdown: float | None = None,
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
    frontier point is returned then. `required` companies are always kept
    (those without a year of history can't be, and are left out)."""
    returns_df = returns_past_year(tickers)
    if not returns_df.empty:
        returns_df = returns_df.dropna(axis=1, thresh=int(len(returns_df) * 0.9)).fillna(0.0)
    if returns_df.shape[1] < 2:
        raise ValueError("Not enough tickers with a year of price history to optimize over")
    return _optimize(returns_df, max_volatility, min_return, min_count, max_count, required, max_drawdown)


def _optimize(
    returns_df,
    max_volatility: float | None,
    min_return: float | None,
    min_count: int | None,
    max_count: int | None,
    required: list[str] | None = None,
    max_drawdown: float | None = None,
) -> dict:
    """`optimize_selection` over an already-fetched returns DataFrame."""
    columns = list(returns_df.columns)
    required = [t for t in (required or []) if t in set(columns)]
    returns = returns_df.values
    floor = _required_floor(columns, required)
    is_required = floor > 0
    frontier = _efficient_frontier(returns, floor=floor)
    # Rank each candidate as it will actually be returned -- with positions
    # below MIN_SELECTED_WEIGHT dropped -- so a point that meets a limit by a
    # hair doesn't slip past it once those slivers are removed.
    best = min(
        (_drop_small_positions(w, floor) for w in _interpolate_frontier(frontier)),
        key=lambda w: _candidate_rank(metrics_from_returns(returns, w), max_volatility, min_return, max_drawdown),
    )

    # Mandatory companies first, then by optimal weight, breaking ties (e.g.
    # zero weights) by mean return.
    mean_returns = returns.mean(axis=0)
    rank = lambda w: lambda i: (not is_required[i], -w[i], -mean_returns[i])  # noqa: E731
    order = sorted(range(len(columns)), key=rank(best))
    auto_size = sum(1 for i in order if best[i] >= MIN_SELECTED_WEIGHT or is_required[i])
    lo = max(2, min_count or 2, len(required))  # RL training needs at least 2 assets
    hi = max(lo, max_count) if max_count is not None else len(columns)
    size = min(max(auto_size, lo), hi, len(columns))
    keep = order[:size]
    if size != auto_size and size < len(columns):
        candidate_sets = {
            tuple(sorted(sorted(range(len(columns)), key=rank(w))[:size]))
            for w in frontier
        }
        # Re-solve over each set; min == max == size keeps all of its companies.
        results = [
            _optimize(returns_df.iloc[:, list(subset)], max_volatility, min_return, size, size, required, max_drawdown)
            for subset in candidate_sets
        ]
        return min(results, key=lambda r: _candidate_rank(r["metrics"], max_volatility, min_return, max_drawdown))

    # Floor at MIN_SELECTED_WEIGHT so a company kept to reach `min_count`
    # still gets a (small) position rather than a zero weight.
    weights = np.maximum(best[keep], MIN_SELECTED_WEIGHT)
    weights = weights / weights.sum()
    metrics = metrics_from_returns(returns[:, keep], weights)
    return {
        "tickers": [columns[i] for i in keep],
        "weights": {columns[i]: float(w) for i, w in zip(keep, weights)},
        "metrics": metrics,
        "feasible": constraint_violation(metrics, max_volatility, min_return, max_drawdown) == 0,
    }


def select_universe(
    tickers: list[str],
    mode: str = "full",
    min_count: int | None = None,
    max_count: int | None = None,
    lookback_days: int = 252,
    max_volatility: float | None = None,
    min_return: float | None = None,
    required: list[str] | None = None,
    max_drawdown: float | None = None,
) -> dict:
    """Decide which companies the agent trains on.

    - "subset" mode first narrows `tickers` to those with an upward trend,
      ranked by K-ratio. With an exact count (min == max) and no limits, it
      keeps the top that-many by K-ratio, as it always has.
    - Otherwise any volatility/return/drawdown limit or company-count bound (and
      always in subset mode) runs `optimize_selection` over the candidates --
      that is what drops companies and sizes the portfolio, within
      [min_count, max_count].
    - "full" mode with no limits and no count bounds trains on every ticker.
    - `required` companies (those in `tickers`) are always kept: they skip
      the trend filter and the optimizer can't drop them.

    Returns {tickers, selection (K-ratio rows, subset mode only), optimizer
    (optimize_selection's result, or None)}."""
    if min_count is not None and max_count is not None and min_count > max_count:
        raise ValueError(f"Min companies ({min_count}) is greater than max companies ({max_count})")
    constrained = max_volatility is not None or min_return is not None or max_drawdown is not None
    bounded = min_count is not None or max_count is not None
    required = [t for t in dict.fromkeys(required or []) if t in set(tickers)]
    candidates, ranked = tickers, None
    if mode == "subset":
        ranked = rank_by_trend_consistency(tickers, lookback_days=lookback_days)
        trending = [r["ticker"] for r in ranked if r["ticker"] not in set(required)]
        if len(required) + len(trending) < 2:
            raise ValueError("Fewer than 2 tickers in this universe have an upward price trend to select from")
        if min_count is not None and min_count == max_count and not constrained:
            chosen = required + trending[: max(2, min_count) - len(required)]
            selection = [r for r in ranked if r["ticker"] in set(chosen)]
            return {"tickers": chosen, "selection": selection, "optimizer": None}
        candidates = required + trending
    elif not constrained and not bounded:
        return {"tickers": tickers, "selection": None, "optimizer": None}

    optimizer = optimize_selection(candidates, max_volatility, min_return, min_count, max_count, required, max_drawdown)
    chosen = set(optimizer["tickers"])
    selection = [r for r in ranked if r["ticker"] in chosen] if ranked is not None else None
    return {"tickers": optimizer["tickers"], "selection": selection, "optimizer": optimizer}


# What the max weight range is measured against (see `weight_range`).
WEIGHT_RANGE_BASES = ("smallest", "largest", "points")


def weight_range(weights, basis: str = "smallest") -> float:
    """Spread of an allocation, max(w) - min(w), measured against `basis`:
    "smallest" -> / min(w) (30% and 5% -> 5.0, i.e. 500%), "largest" ->
    / max(w) (-> 0.83), "points" -> as is (-> 0.25, 25 points). Infinite
    for "smallest" when a weight is 0."""
    w = np.asarray(weights, dtype=np.float64)
    if not len(w):
        return 0.0
    spread = float(w.max() - w.min())
    if basis == "points":
        return spread
    if basis == "largest":
        return float(spread / w.max()) if w.max() > 0 else 0.0
    return float(spread / w.min()) if w.min() > 0 else float("inf")


def _cap_weight_range(weights: np.ndarray, max_range: float | None, basis: str = "smallest") -> tuple[np.ndarray, float]:
    """Enforce weight_range(w, basis) <= max_range by blending toward equal
    weights, w' = (1 - a) w + a/n, with the smallest share a that does it.
    The blend keeps the order (M, m stay the largest / smallest) and the sum,
    and equal weights have range 0, so it is always reachable. With
    L = max_range:
      points:   (1 - a)(M - m) <= L                  -> a = 1 - L / (M - m)
      smallest: (1 - a)M + a/n <= (1 + L)((1 - a)m + a/n)
                -> a = D / (D + L/n), D = M - (1 + L) m
      largest:  (1 - L)((1 - a)M + a/n) <= (1 - a)m + a/n
                -> a = D / (D + L/n), D = (1 - L) M - m
    Returns (weights, a)."""
    if max_range is None or not len(weights) or weight_range(weights, basis) <= max_range + 1e-12:
        return weights, 0.0
    n = len(weights)
    big, small = weights.max(), weights.min()
    if basis == "points":
        a = 1.0 - max_range / (big - small)
    else:
        excess = big - (1.0 + max_range) * small if basis == "smallest" else (1.0 - max_range) * big - small
        a = excess / (excess + max_range / n)
    a = min(1.0, max(0.0, a))
    return (1.0 - a) * weights + a * np.full(n, 1.0 / n), a


def _enforce_constraints(
    tickers: list[str],
    weights: np.ndarray,
    max_volatility: float | None,
    min_return: float | None,
    anchor: dict[str, float] | None = None,
    max_weight_range: float | None = None,
    weight_range_basis: str = "smallest",
    max_drawdown: float | None = None,
) -> tuple[np.ndarray, float]:
    """The env's constraint penalty is soft, so the learned weights can
    still miss the target. If they do, blend them toward an anchor
    allocation -- the optimizer's weights when given (feasible whenever the
    limits are reachable at all), plus equal and inverse-volatility weights --
    using the smallest blend that satisfies the constraints, so the result
    stays as close to the RL policy as possible. Returns (weights, blend)
    where blend is the anchor's share (0 = RL weights unchanged). If no
    blend is feasible, the closest one is returned. With `max_weight_range`,
    every candidate is range-capped first (`_cap_weight_range`), so the
    volatility/return limits are judged on what will actually be returned."""
    cap = lambda w: _cap_weight_range(w, max_weight_range, weight_range_basis)[0]  # noqa: E731
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

    best_weights, best_blend = cap(weights), 0.0
    best_key = _candidate_rank(metrics_from_returns(returns, best_weights), max_volatility, min_return, max_drawdown)
    for blend in BLEND_STEPS[1:]:
        if not best_key[0]:
            break  # smallest feasible blend found
        for candidate_anchor in anchors:
            candidate = cap((1 - blend) * weights + blend * candidate_anchor)
            key = _candidate_rank(metrics_from_returns(returns, candidate), max_volatility, min_return, max_drawdown)
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
    max_weight_range: float | None = None,
    weight_range_basis: str = "smallest",
    transaction_cost: float = TRANSACTION_COST,
    max_drawdown: float | None = None,
    training_days: int | None = None,
    seed: int = DEFAULT_SEED,
    cross_validate: bool | None = None,
) -> dict:
    """`training_days`: history window in trading days (None = the shared
    Settings value, ~10 years -- the same window the LSTM and ARIMA use),
    split train | validation | test like theirs (see the module docstring).
    `cross_validate` (None = the Settings value, on by default): choose the
    risk aversion among `CV_RISK_AVERSIONS` + `risk_aversion` by
    expanding-window cross-validation on the years before the test
    (`_cross_validate`); the chosen value is used for training and stored.
    Companies listed later than the window start get weight 0 until their
    first trading day. `seed` fixes PPO's randomness.
    `max_drawdown` (optional, fraction): ceiling on the past-year max
    drawdown of the final weights, enforced like the volatility / return
    limits (blend toward the optimizer's weights).
    `max_weight_range` (optional, fraction): cap on max(w) - min(w) across
    the holdings, measured against `weight_range_basis` (see `weight_range`;
    "smallest": 0.5 = the largest at most 1.5x the smallest), applied to the
    learned weights (see `_cap_weight_range`)."""
    tickers = universe or default_universe()
    if len(tickers) < 2:
        raise ValueError("Need at least 2 tickers to build a portfolio")

    training_days = int(training_days or training_days_setting())
    returns_df = returns_matrix(tickers, lookback_days=training_days)  # capped by what's stored
    returns_df = returns_df.dropna(axis=1, thresh=MIN_HISTORY_DAYS)
    if returns_df.shape[1] < 2:
        raise ValueError("Not enough tickers with sufficient price history to train on")
    # Listed from its first stored return on; before that the agent can't hold it.
    available = returns_df.notna().cummax().values
    returns_df = returns_df.fillna(0.0)

    n_days = returns_df.shape[0]
    val_start, test_start = split_points(n_days)
    if val_start - window < 30 or test_start - val_start < 5 or n_days - test_start < 5:
        raise ValueError(
            f"Not enough historical days ({n_days}) for window={window} plus validation and test periods; "
            "import more history first"
        )

    used_tickers = list(returns_df.columns)
    returns = returns_df.values
    dates = [str(d) for d in returns_df.index]

    def make_env(start: int, end: int, ra: float | None = None) -> PortfolioEnv:
        return PortfolioEnv(
            returns, window=window, risk_aversion=risk_aversion if ra is None else ra,
            max_volatility=max_volatility, min_return=min_return, transaction_cost=transaction_cost,
            available=available, start=start, end=end,
        )

    # 1. Cross-validate the risk aversion on the years before the test.
    if cross_validate is None:
        cross_validate = cross_validate_setting()
    candidates = sorted(set(CV_RISK_AVERSIONS) | {float(risk_aversion)})
    n_folds = len([s for s, _e in expanding_folds(test_start) if s - window >= 30]) if cross_validate else 0
    cv_steps = len(candidates) * n_folds * timesteps if n_folds >= 2 else 0
    grand_total = cv_steps + timesteps

    def progress(offset: int, stage: str):
        if not progress_room:
            return None
        return SocketIOProgressCallback(progress_room, timesteps, task=progress_task, offset=offset,
                                        grand_total=grand_total, stage=stage)

    requested_risk_aversion = risk_aversion
    cv = None
    if cv_steps:
        cv = _cross_validate(make_env, returns, dates, window, test_start, candidates, timesteps, seed,
                             transaction_cost, progress=lambda done: progress(done, "cross-validating"))
        if cv:
            risk_aversion = cv["chosen_risk_aversion"]

    # 2. Train with it; keep the best checkpoint on the validation year.
    env = make_env(window, val_start)
    model = PPO("MlpPolicy", env, verbose=0, seed=seed)

    checkpoint = ValidationCheckpoint(make_env(val_start, test_start))
    callbacks = [checkpoint]
    if progress_room:
        callbacks.append(progress(cv_steps, "training"))
    model.learn(total_timesteps=timesteps, callback=callbacks)
    checkpoint.evaluate()  # the final policy is a candidate too
    model.policy.load_state_dict(checkpoint.best_state)

    test = _test_report(model, make_env(test_start, n_days), returns, test_start, n_days, transaction_cost)
    evaluation = {
        "training_days": n_days,
        "train": {"from": dates[window], "to": dates[val_start - 1], "days": val_start - window},
        "validation": {"from": dates[val_start], "to": dates[test_start - 1], "days": test_start - val_start},
        "test": {"from": dates[test_start], "to": dates[-1], "days": n_days - test_start, **test},
        "best_timestep": checkpoint.best_step,
        "validation_reward": round(checkpoint.best_score, 6),
        "validation_checks": checkpoint.evaluations,
        "seed": seed,
        "risk_aversion": risk_aversion,
        "requested_risk_aversion": requested_risk_aversion,
        "cross_validation": cv,
    }

    # Apply the chosen policy to the most recent window to get today's recommendation.
    last = len(returns) - 1
    final_obs = np.concatenate([returns[-window:].flatten(), np.ones(len(used_tickers)) / len(used_tickers)])
    action, _ = model.predict(final_obs.astype(np.float32), deterministic=True)
    weights = PortfolioEnv.masked_softmax(action, available[last])

    constrained = max_volatility is not None or min_return is not None or max_drawdown is not None
    blend = 0.0
    learned_range = weight_range(weights, weight_range_basis)
    if constrained:
        weights, blend = _enforce_constraints(
            used_tickers, weights, max_volatility, min_return, anchor,
            max_weight_range=max_weight_range, weight_range_basis=weight_range_basis, max_drawdown=max_drawdown,
        )
    weights, _ = _cap_weight_range(weights, max_weight_range, weight_range_basis)  # no-op when already within the range

    holdings = [{"ticker": ticker, "weight": float(weight)} for ticker, weight in zip(used_tickers, weights)]
    metrics = compute_metrics(holdings)
    constraints = None
    if constrained or max_weight_range is not None:
        final_range = weight_range(weights, weight_range_basis)
        range_ok = max_weight_range is None or final_range <= max_weight_range + 1e-9
        constraints = {
            "max_volatility": max_volatility,
            "min_return": min_return,
            "max_drawdown": max_drawdown,
            "max_weight_range": max_weight_range,
            "weight_range_basis": weight_range_basis,
            "weight_range": round(final_range, 4),
            "learned_weight_range": round(learned_range, 4),
            "satisfied": constraint_violation(metrics, max_volatility, min_return, max_drawdown) == 0 and range_ok,
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
        "evaluation": evaluation,
        "model_path": model_path,
        "hyperparams": {
            "algorithm": "PPO",
            "timesteps": timesteps,
            "training_days": n_days,
            "seed": seed,
            "risk_aversion": risk_aversion,
            "window": window,
            "transaction_cost": transaction_cost,
            "max_volatility": max_volatility,
            "min_return": min_return,
            "max_drawdown": max_drawdown,
            "max_weight_range": max_weight_range,
            "weight_range_basis": weight_range_basis,
        },
    }
