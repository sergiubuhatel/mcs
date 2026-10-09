"""Trigger per-ticker ARIMA price forecasting (async, Celery) and fetch results.

Progress streams live over Socket.IO to the room named after the returned
``task_id`` (event ``arima_progress``); poll ``/status`` as a fallback.
"""

from celery.result import AsyncResult
from flask import Blueprint, jsonify, request

from ..db.arango_client import get_db
from ..services.lstm_service import DEFAULT_LOOKBACK_DAYS
from ..tasks.arima_tasks import train_arima_prediction
from ..tasks.celery_app import celery_app

bp = Blueprint("arima", __name__, url_prefix="/api/arima")


@bp.post("/train")
def train():
    body = request.get_json(silent=True) or {}
    ticker = body.get("ticker")
    if not ticker:
        return jsonify({"error": "'ticker' is required"}), 400

    order = body.get("order")
    if order is not None and (not isinstance(order, list) or len(order) != 3):
        return jsonify({"error": "'order' must be [p, d, q]"}), 400

    lookback = body.get("lookback_days", DEFAULT_LOOKBACK_DAYS)
    task = train_arima_prediction.delay(
        ticker=ticker,
        order=[int(v) for v in order] if order else None,
        d=int(body.get("d", 1)),
        max_p=int(body.get("max_p", 3)),
        max_q=int(body.get("max_q", 3)),
        lookback_days=int(lookback) if lookback else None,
        forecast_days=int(body.get("forecast_days", 7)),
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


@bp.get("/<ticker>")
def get_prediction(ticker: str):
    db = get_db()
    col = db.collection("arima_predictions")
    ticker = ticker.upper()
    if not col.has(ticker):
        return jsonify({"error": f"No ARIMA forecast stored yet for '{ticker}'"}), 404
    return jsonify(col.get(ticker))
