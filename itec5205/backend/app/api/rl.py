"""Trigger RL-based portfolio generation (async, Celery) and check on it.

Progress is also pushed live over Socket.IO to the room named after the
returned ``task_id`` (event ``rl_progress``) — poll ``/status`` as a
fallback if the socket connection drops.
"""

from celery.result import AsyncResult
from flask import Blueprint, jsonify, request

from ..services.pool_service import get_pool
from ..services.rl_service import WEIGHT_RANGE_BASES
from ..services.signal_service import SIGNAL_STRONG, build_signals, latest_portfolio_for_pool
from ..tasks.celery_app import celery_app
from ..tasks.rl_tasks import train_rl_portfolio

bp = Blueprint("rl", __name__, url_prefix="/api/rl")


def _optional(value, cast):
    """None for a missing/blank field -- these are "no constraint" / "auto"."""
    return None if value in (None, "") else cast(value)


@bp.post("/train")
def train():
    body = request.get_json(silent=True) or {}

    universe = body.get("universe")
    pool_id = body.get("pool_id")
    mode = body.get("mode", "full")
    required = [t.upper() for t in body.get("required_tickers") or []]
    excluded = [t.upper() for t in body.get("excluded_tickers") or []]
    if pool_id:
        pool = get_pool(pool_id)
        if pool is None:
            return jsonify({"error": f"Pool '{pool_id}' not found"}), 404
        universe = pool["tickers"]
        required = list(dict.fromkeys(required + pool.get("required_tickers", [])))
        excluded = list(dict.fromkeys(excluded + pool.get("excluded_tickers", [])))
        if mode == "strong":
            # Only the companies the signal board currently rates Strong; from
            # here on it trains like "full" mode over that narrower universe.
            board = build_signals(universe, pool=pool, portfolio=latest_portfolio_for_pool(pool_id))
            universe = [r["ticker"] for r in board["rows"] if r["signal"] == SIGNAL_STRONG]
            # Mandatory pool companies stay in even when they aren't Strong.
            universe += [t for t in required if t in set(pool["tickers"]) and t not in set(universe)]
            if len(universe) < 2:
                return jsonify({"error": f"Only {len(universe)} Strong companies in this pool -- need at least 2 (run Forecast all first)"}), 400
    elif mode == "strong":
        return jsonify({"error": "'strong' mode needs a pool_id"}), 400
    basis = body.get("weight_range_basis") or "smallest"
    if basis not in WEIGHT_RANGE_BASES:
        return jsonify({"error": f"'weight_range_basis' must be one of {', '.join(WEIGHT_RANGE_BASES)}"}), 400
    both = sorted(set(required) & set(excluded))
    if both:
        return jsonify({"error": f"{', '.join(both)} can't be both mandatory and excluded"}), 400

    task = train_rl_portfolio.delay(
        universe=universe,
        risk_aversion=float(body.get("risk_aversion", 1.0)),
        timesteps=int(body.get("timesteps", 50_000)),
        window=int(body.get("window", 30)),
        portfolio_name=body.get("portfolio_name"),
        mode=mode,
        min_companies=_optional(body.get("min_companies"), int),
        max_companies=_optional(body.get("max_companies"), int),
        lookback_days=int(body.get("lookback_days", 252)),
        max_volatility=_optional(body.get("max_volatility"), float),
        min_return=_optional(body.get("min_return"), float),
        max_weight_range=_optional(body.get("max_weight_range"), float),
        weight_range_basis=basis,
        required_tickers=required,
        excluded_tickers=excluded,
        pool_id=pool_id,
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
