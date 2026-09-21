"""Trigger RL-based portfolio generation (async, Celery) and check on it.

Progress is also pushed live over Socket.IO to the room named after the
returned ``task_id`` (event ``rl_progress``) — poll ``/status`` as a
fallback if the socket connection drops.
"""

from celery.result import AsyncResult
from flask import Blueprint, jsonify, request

from ..services.pool_service import get_pool
from ..tasks.celery_app import celery_app
from ..tasks.rl_tasks import train_rl_portfolio

bp = Blueprint("rl", __name__, url_prefix="/api/rl")


@bp.post("/train")
def train():
    body = request.get_json(silent=True) or {}

    universe = body.get("universe")
    pool_id = body.get("pool_id")
    if pool_id:
        pool = get_pool(pool_id)
        if pool is None:
            return jsonify({"error": f"Pool '{pool_id}' not found"}), 404
        universe = pool["tickers"]

    task = train_rl_portfolio.delay(
        universe=universe,
        risk_aversion=float(body.get("risk_aversion", 1.0)),
        timesteps=int(body.get("timesteps", 50_000)),
        window=int(body.get("window", 30)),
        portfolio_name=body.get("portfolio_name"),
        mode=body.get("mode", "full"),
        subset_size=int(body.get("subset_size", 10)),
        lookback_days=int(body.get("lookback_days", 252)),
    )
    return jsonify({"task_id": task.id}), 202


@bp.get("/status/<task_id>")
def status(task_id: str):
    result = AsyncResult(task_id, app=celery_app)
    payload = {"task_id": task_id, "state": result.state}
    if result.state == "PROGRESS":
        payload["progress"] = result.info
    elif result.state == "SUCCESS":
        payload["result"] = result.result
    elif result.state == "FAILURE":
        payload["error"] = str(result.info)
    return jsonify(payload)
