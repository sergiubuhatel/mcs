"""Trigger the bulk Yahoo Finance -> ArangoDB import job and check on it.

Progress is pushed live over Socket.IO to the room named after the returned
``task_id`` (event ``import_progress``); poll ``/import/status`` as a
fallback.
"""

from celery.result import AsyncResult
from flask import Blueprint, jsonify, request

from .. import config
from ..services.yahoo_import import get_existing_tickers, read_tickers
from ..tasks.celery_app import celery_app
from ..tasks.import_tasks import import_sp500_data

bp = Blueprint("data", __name__, url_prefix="/api/data")


@bp.post("/import")
def trigger_import():
    body = request.get_json(silent=True) or {}
    tickers = body.get("tickers")
    if not tickers:
        tickers = read_tickers(config.TICKERS_FILE)
    tickers = [t.upper() for t in tickers]

    if body.get("only_missing"):
        existing = get_existing_tickers()
        tickers = [t for t in tickers if t not in existing]
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
