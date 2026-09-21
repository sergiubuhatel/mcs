"""Background job: train a PPO portfolio-allocation policy and save the
result as a new portfolio + an rl_runs record. Training (even a modest
number of timesteps) is too slow for a synchronous HTTP request.
"""

from datetime import datetime, timezone

from ..db.arango_client import get_db
from ..extensions import socketio
from ..services.portfolio_service import create_portfolio
from ..services.rl_service import train_and_recommend
from .celery_app import celery_app


@celery_app.task(bind=True, name="train_rl_portfolio")
def train_rl_portfolio(
    self,
    universe: list[str] | None = None,
    risk_aversion: float = 1.0,
    timesteps: int = 50_000,
    window: int = 30,
    portfolio_name: str | None = None,
):
    room = self.request.id
    self.update_state(state="PROGRESS", meta={"stage": "training", "timesteps": timesteps})
    socketio.emit("rl_progress", {"stage": "starting", "completed": 0, "total": timesteps}, room=room)

    result = train_and_recommend(
        universe=universe, risk_aversion=risk_aversion, timesteps=timesteps, window=window,
        progress_room=room, progress_task=self,
    )

    name = portfolio_name or f"RL Portfolio {result['run_id'][:8]}"
    portfolio = create_portfolio(
        name=name,
        holdings=result["holdings"],
        method="rl",
        notes=f"PPO, timesteps={timesteps}, risk_aversion={risk_aversion}, window={window}",
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
        }
    )

    summary = {
        "run_id": result["run_id"],
        "portfolio_id": portfolio["_key"],
        "holdings": result["holdings"],
        "metrics": result["metrics"],
    }
    socketio.emit("rl_progress", {"stage": "done", **summary}, room=room)
    return summary
