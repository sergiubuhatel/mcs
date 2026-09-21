"""Background job: train a PPO portfolio-allocation policy and save the
result as a new portfolio + an rl_runs record. Training (even a modest
number of timesteps) is too slow for a synchronous HTTP request.
"""

from datetime import datetime, timezone

from ..db.arango_client import get_db
from ..extensions import socketio
from ..services.portfolio_service import create_portfolio
from ..services.rl_service import default_universe, select_subset_by_trend_consistency, train_and_recommend
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
    subset_size: int = 10,
    lookback_days: int = 252,
):
    room = self.request.id

    selection = None
    if mode == "subset":
        self.update_state(state="PROGRESS", meta={"stage": "selecting"})
        socketio.emit("rl_progress", {"stage": "selecting"}, room=room)
        selection = select_subset_by_trend_consistency(universe or default_universe(), subset_size, lookback_days=lookback_days)
        universe = [row["ticker"] for row in selection]

    self.update_state(state="PROGRESS", meta={"stage": "training", "timesteps": timesteps})
    socketio.emit("rl_progress", {"stage": "starting", "completed": 0, "total": timesteps}, room=room)

    result = train_and_recommend(
        universe=universe, risk_aversion=risk_aversion, timesteps=timesteps, window=window,
        progress_room=room, progress_task=self,
    )

    name = portfolio_name or f"RL Portfolio {result['run_id'][:8]}"
    notes = f"PPO, timesteps={timesteps}, risk_aversion={risk_aversion}, window={window}"
    if mode == "subset":
        notes += f", subset of {subset_size} selected by trend consistency (K-ratio, {lookback_days}-day lookback)"
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
        }
    )

    summary = {
        "run_id": result["run_id"],
        "portfolio_id": portfolio["_key"],
        "holdings": result["holdings"],
        "metrics": result["metrics"],
        "selection": selection,
    }
    socketio.emit("rl_progress", {"stage": "done", **summary}, room=room)
    return summary
