"""Background job: train a PPO portfolio-allocation policy and save the
result as a new portfolio + an rl_runs record. Training (even a modest
number of timesteps) is too slow for a synchronous HTTP request.
"""

from datetime import datetime, timezone

from ..db.arango_client import get_db
from ..extensions import socketio
from ..services.portfolio_service import create_portfolio
from ..services.rl_service import default_universe, select_universe, train_and_recommend
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
    subset_size: int | None = 10,
    lookback_days: int = 252,
    max_volatility: float | None = None,
    min_return: float | None = None,
):
    """`subset_size=None` lets the optimizer decide how many companies to
    keep (see `rl_service.select_universe`). `max_volatility` / `min_return`
    are annualized fractions (0.25 = 25%)."""
    room = self.request.id

    self.update_state(state="PROGRESS", meta={"stage": "selecting"})
    socketio.emit("rl_progress", {"stage": "selecting"}, room=room)
    chosen = select_universe(
        universe or default_universe(), mode=mode, count=subset_size, lookback_days=lookback_days,
        max_volatility=max_volatility, min_return=min_return,
    )
    universe, selection, optimizer = chosen["tickers"], chosen["selection"], chosen["optimizer"]
    auto_sized = optimizer is not None and subset_size is None

    self.update_state(state="PROGRESS", meta={"stage": "training", "timesteps": timesteps})
    socketio.emit("rl_progress", {"stage": "starting", "completed": 0, "total": timesteps}, room=room)

    result = train_and_recommend(
        universe=universe, risk_aversion=risk_aversion, timesteps=timesteps, window=window,
        progress_room=room, progress_task=self, max_volatility=max_volatility, min_return=min_return,
        anchor=optimizer["weights"] if optimizer else None,
    )
    constraints = result["constraints"]
    if constraints is not None and optimizer is not None:
        # Whether *any* long-only mix of the candidates meets the limits, and
        # the best that's achievable -- so an unmet limit is explained, not silent.
        constraints = {**constraints, "feasible": optimizer["feasible"], "best_achievable": optimizer["metrics"]}

    name = portfolio_name or f"RL Portfolio {result['run_id'][:8]}"
    notes = f"PPO, timesteps={timesteps}, risk_aversion={risk_aversion}, window={window}"
    if mode == "subset":
        notes += f", candidates filtered by trend consistency (K-ratio, {lookback_days}-day lookback)"
    if optimizer is not None:
        notes += f", {len(universe)} companies selected by mean-variance optimizer"
        notes += " (auto-sized)" if auto_sized else ""
    if max_volatility is not None:
        notes += f", max volatility={max_volatility:.0%}"
    if min_return is not None:
        notes += f", min annual return={min_return:.0%}"
    if constraints and constraints["blend"] > 0:
        notes += f", blended {constraints['blend']:.0%} toward the optimizer allocation to meet constraints"
    portfolio = create_portfolio(
        name=name,
        holdings=result["holdings"],
        method="rl",
        notes=notes,
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
    }
    socketio.emit("rl_progress", {"stage": "done", **summary}, room=room)
    return summary
