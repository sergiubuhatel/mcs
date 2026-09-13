"""Trigger per-ticker LSTM price prediction (async, Celery) and fetch results.

Progress streams live over Socket.IO to the room named after the returned
``task_id`` (event ``prediction_progress``); poll ``/status`` as a fallback.
"""

from celery.result import AsyncResult
from flask import Blueprint, jsonify, request

from ..db.arango_client import get_db
from ..tasks.celery_app import celery_app
from ..tasks.predict_tasks import train_lstm_prediction

bp = Blueprint("predictions", __name__, url_prefix="/api/predictions")


@bp.post("/train")
def train():
    body = request.get_json(silent=True) or {}
    ticker = body.get("ticker")
    if not ticker:
        return jsonify({"error": "'ticker' is required"}), 400

    task = train_lstm_prediction.delay(
        ticker=ticker,
        seq_len=int(body.get("seq_len", 20)),
        epochs=int(body.get("epochs", 30)),
        hidden_size=int(body.get("hidden_size", 32)),
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
    col = db.collection("price_predictions")
    ticker = ticker.upper()
    if not col.has(ticker):
        return jsonify({"error": f"No prediction stored yet for '{ticker}'"}), 404
    return jsonify(col.get(ticker))
