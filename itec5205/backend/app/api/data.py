"""Trigger the bulk Yahoo Finance -> ArangoDB import job and check on it.

Progress is pushed live over Socket.IO to the room named after the returned
``task_id`` (event ``import_progress``); poll ``/import/status`` as a
fallback.
"""

from celery.result import AsyncResult
from flask import Blueprint, jsonify, request

from .. import config
from ..services.yahoo_import import get_up_to_date_tickers, read_tickers
from ..tasks.celery_app import celery_app
from ..tasks.import_tasks import import_sp500_data
from ..tasks.stop_flags import request_stop

bp = Blueprint("data", __name__, url_prefix="/api/data")


@bp.post("/import")
def trigger_import():
    body = request.get_json(silent=True) or {}
    tickers = body.get("tickers")
    if not tickers:
        tickers = read_tickers(config.TICKERS_FILE)
    tickers = [t.upper() for t in tickers]

    if body.get("only_missing"):
        up_to_date = get_up_to_date_tickers()
        tickers = [t for t in tickers if t not in up_to_date]
        if not tickers:
            return jsonify({"task_id": None, "ticker_count": 0, "message": "Everything requested is already imported."}), 200

    task = import_sp500_data.delay(
        tickers=tickers,
        years=int(body.get("years", 10)),
        interval=body.get("interval", "1d"),
    )
    return jsonify({"task_id": task.id, "ticker_count": len(tickers)}), 202


@bp.get("/import/status/<task_id>")
def import_status(task_id: str):
    result = AsyncResult(task_id, app=celery_app)
    payload = {"task_id": task_id, "state": result.state}
    if result.state == "PROGRESS":
        payload["progress"] = result.info
    elif result.state == "SUCCESS":
        payload["result"] = result.result
    elif result.state == "FAILURE":
        payload["error"] = str(result.info)
    return jsonify(payload)


@bp.post("/import/stop/<task_id>")
def stop_import(task_id: str):
    """Cooperative stop: flags the task; it exits (with a resumable result)
    the next time it checks in, between tickers -- not instantly."""
    request_stop(task_id)
    return jsonify({"task_id": task_id, "stopping": True})


@bp.post("/import/resume/<task_id>")
def resume_import(task_id: str):
    """Continue a previously-stopped import from where it left off."""
    result = AsyncResult(task_id, app=celery_app)
    prior = result.result if result.state == "SUCCESS" else None
    remaining = (prior or {}).get("remaining_tickers") if isinstance(prior, dict) else None
    if not remaining:
        return jsonify({"error": "Nothing to resume for this task."}), 400

    task = import_sp500_data.delay(
        tickers=remaining,
        years=prior.get("years", 10),
        interval=prior.get("interval", "1d"),
    )
    return jsonify({"task_id": task.id, "ticker_count": len(remaining)}), 202
