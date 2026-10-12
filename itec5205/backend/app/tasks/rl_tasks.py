"""Background job: train a PPO portfolio-allocation policy and save the
result as a new portfolio + an rl_runs record. Training (even a modest
number of timesteps) is too slow for a synchronous HTTP request.
"""

from datetime import datetime, timezone

from ..db.arango_client import get_db
from ..extensions import socketio
from ..services.portfolio_service import create_portfolio
from ..services.rl_service import default_universe, excluded_for_history, select_universe, train_and_recommend
from .celery_app import celery_app


@celery_app.task(bind=True, name="train_rl_portfolio")
def train_rl_portfolio(
    self,
    universe: list[str] | None = None,
    risk_aversion: float = 1.0,
    timesteps: int = 50_000,
    window: int = 30,
    portfolio_name: str | None = None,
    mode: str = "full",
    min_companies: int | None = None,
    max_companies: int | None = None,
    lookback_days: int = 252,
    max_volatility: float | None = None,
    min_return: float | None = None,
    pool_id: str | None = None,
    max_weight_range: float | None = None,
    weight_range_basis: str = "smallest",
    required_tickers: list[str] | None = None,
    excluded_tickers: list[str] | None = None,
):
    """The optimizer decides how many companies to keep, within the optional
    [min_companies, max_companies] bounds (see `rl_service.select_universe`). `max_volatility` / `min_return`
    are annualized fractions (0.25 = 25%); `max_weight_range` caps
    max(weight) - min(weight) across the holdings, measured against
    `weight_range_basis` ("smallest" / "largest" holding, or "points").
    `required_tickers` must end up in the portfolio -- those that are in the
    input universe; the rest are ignored and reported. `excluded_tickers`
    are taken out of the universe before anything else, so they never are."""
    room = self.request.id
    requested = universe or default_universe()
    banned = {t.upper() for t in excluded_tickers or []}
    user_excluded = [t for t in requested if t in banned]
    requested = [t for t in requested if t not in banned]
    if len(requested) < 2:
        raise ValueError(f"Only {len(requested)} companies left after the excluded stocks -- need at least 2")
    mandatory = [t.upper() for t in dict.fromkeys(required_tickers or [])]
    required = [t for t in mandatory if t in set(requested)]

    self.update_state(state="PROGRESS", meta={"stage": "selecting"})
    socketio.emit("rl_progress", {"stage": "selecting"}, room=room)
    chosen = select_universe(
        requested, mode=mode, min_count=min_companies, max_count=max_companies, lookback_days=lookback_days,
        max_volatility=max_volatility, min_return=min_return, required=required,
    )
    universe, selection, optimizer = chosen["tickers"], chosen["selection"], chosen["optimizer"]
    auto_sized = optimizer is not None and (min_companies is None or min_companies != max_companies)

    self.update_state(state="PROGRESS", meta={"stage": "training", "timesteps": timesteps})
    socketio.emit("rl_progress", {"stage": "starting", "completed": 0, "total": timesteps}, room=room)

    result = train_and_recommend(
        universe=universe, risk_aversion=risk_aversion, timesteps=timesteps, window=window,
        progress_room=room, progress_task=self, max_volatility=max_volatility, min_return=min_return,
        anchor=optimizer["weights"] if optimizer else None, max_weight_range=max_weight_range,
        weight_range_basis=weight_range_basis,
    )
    constraints = result["constraints"]
    excluded = excluded_for_history(requested, result["tickers"], mode, optimizer is not None, lookback_days)
    mandatory_report = None
    if mandatory:
        mandatory_report = {
            "requested": mandatory,
            "included": [t for t in required if t in set(result["tickers"])],
            "not_in_input": [t for t in mandatory if t not in set(requested)],
            # In the input but too little price history to train on.
            "left_out": [t for t in required if t not in set(result["tickers"])],
        }
    if constraints is not None and optimizer is not None:
        # Whether *any* long-only mix of the candidates meets the limits, and
        # the best that's achievable -- so an unmet limit is explained, not silent.
        constraints = {**constraints, "feasible": optimizer["feasible"], "best_achievable": optimizer["metrics"]}

    name = portfolio_name or f"RL Portfolio {result['run_id'][:8]}"
    notes = f"PPO, timesteps={timesteps}, risk_aversion={risk_aversion}, window={window}"
    if mode == "subset":
        notes += f", candidates filtered by trend consistency (K-ratio, {lookback_days}-day lookback)"
    elif mode == "strong":
        notes += f", candidates limited to the {len(requested)} Strong signals"
    if optimizer is not None:
        notes += f", {len(universe)} companies selected by mean-variance optimizer"
        notes += " (auto-sized)" if auto_sized else ""
    if max_volatility is not None:
        notes += f", max volatility={max_volatility:.0%}"
    if min_return is not None:
        notes += f", min annual return={min_return:.0%}"
    if max_weight_range is not None:
        notes += ", max weight range=" + (
            f"{max_weight_range * 100:g} points" if weight_range_basis == "points"
            else f"{max_weight_range:.0%} of the {weight_range_basis} holding"
        )
    if mandatory_report:
        if mandatory_report["included"]:
            notes += ", mandatory: " + ", ".join(mandatory_report["included"])
        if mandatory_report["not_in_input"]:
            notes += ", mandatory but not in the input (ignored): " + ", ".join(mandatory_report["not_in_input"])
    if user_excluded:
        notes += ", excluded: " + ", ".join(user_excluded)
    if excluded:
        notes += ", left out for too little price history: " + ", ".join(
            f"{row['ticker']} ({row['days']} days)" for row in excluded
        )
    if constraints and constraints["blend"] > 0:
        notes += f", blended {constraints['blend']:.0%} toward the optimizer allocation to meet constraints"
    portfolio = create_portfolio(
        name=name,
        holdings=result["holdings"],
        method="rl",
        notes=notes,
        source_pool_id=pool_id,
    )

    db = get_db()
    db.collection("rl_runs").insert(
        {
            "_key": result["run_id"],
            "created_at": datetime.now(timezone.utc).isoformat(),
            "algorithm": "PPO",
            "hyperparams": result["hyperparams"],
            "universe": result["tickers"],
            "status": "SUCCESS",
            "resulting_portfolio_id": portfolio["_key"],
            "metrics": result["metrics"],
            "model_path": result["model_path"],
            "selection_mode": mode,
            "selection": selection,
            "subset_size_auto": auto_sized,
            "constraints": constraints,
            "excluded": excluded,
            "mandatory": mandatory_report,
            "user_excluded": user_excluded,
            "pool_id": pool_id,
        }
    )

    summary = {
        "run_id": result["run_id"],
        "portfolio_id": portfolio["_key"],
        "holdings": result["holdings"],
        "metrics": result["metrics"],
        "selection": selection,
        "subset_size_auto": auto_sized,
        "constraints": constraints,
        "excluded": excluded,
        "mandatory": mandatory_report,
        "user_excluded": user_excluded,
        "min_companies": min_companies,
    }
    socketio.emit("rl_progress", {"stage": "done", **summary}, room=room)
    return summary
