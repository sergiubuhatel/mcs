"""Trigger per-ticker LSTM price prediction (async, Celery) and fetch results.

Progress streams live over Socket.IO to the room named after the returned
``task_id`` (event ``prediction_progress``); poll ``/status`` as a fallback.
"""

from celery.result import AsyncResult
from flask import Blueprint, jsonify, request

from ..db.arango_client import get_db
from ..services.activity import refuse_if_busy
from ..services.horizons import MAX_HORIZON_DAYS
from ..services.lstm_service import DEFAULT_LOOKBACK_DAYS
from ..services.universes import MAX_RESULTS
from ..tasks.celery_app import celery_app
from ..tasks.predict_tasks import train_lstm_prediction

bp = Blueprint("predictions", __name__, url_prefix="/api/predictions")


@bp.post("/train")
def train():
    busy = refuse_if_busy("forecast")
    if busy:
        return busy
    body = request.get_json(silent=True) or {}
    ticker = body.get("ticker")
    if not ticker:
        return jsonify({"error": "'ticker' is required"}), 400

    lookback = body.get("lookback_days", DEFAULT_LOOKBACK_DAYS)
    task = train_lstm_prediction.delay(
        ticker=ticker,
        seq_len=int(body.get("seq_len", 20)),
        epochs=int(body.get("epochs", 100)),
        hidden_size=int(body.get("hidden_size", 32)),
        forecast_days=max(int(body.get("forecast_days", MAX_HORIZON_DAYS)), MAX_HORIZON_DAYS),
        lookback_days=int(lookback) if lookback else None,
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


@bp.get("/recent")
def recent_predictions():
    """Tickers with a stored LSTM and/or ARIMA forecast, most recently
    trained first (``?limit=``, default 8, max MAX_RESULTS), with each model's
    per-horizon changes -- for the Price Forecasts page's history list."""
    limit = max(1, min(int(request.args.get("limit", 8)), MAX_RESULTS))
    rows = list(get_db().aql.execute(
        """
        LET tickers = UNION_DISTINCT(
            (FOR p IN price_predictions RETURN p._key),
            (FOR a IN arima_predictions RETURN a._key)
        )
        FOR t IN tickers
            LET l = DOCUMENT("price_predictions", t)
            LET a = DOCUMENT("arima_predictions", t)
            LET trained_at = MAX([l.trained_at, a.trained_at])
            SORT trained_at DESC
            LIMIT @n
            RETURN {
                ticker: t,
                name: DOCUMENT("companies", t).name,
                trained_at,
                lstm: l == null ? null : {trained_at: l.trained_at, horizons: l.horizons},
                arima: a == null ? null : {trained_at: a.trained_at, horizons: a.horizons}
            }
        """,
        bind_vars={"n": limit},
    ))
    total = next(iter(get_db().aql.execute(
        "RETURN LENGTH(UNION_DISTINCT((FOR p IN price_predictions RETURN p._key), (FOR a IN arima_predictions RETURN a._key)))"
    )))
    return jsonify({"predictions": rows, "total": total})


@bp.get("/<ticker>")
def get_prediction(ticker: str):
    db = get_db()
    col = db.collection("price_predictions")
    ticker = ticker.upper()
    if not col.has(ticker):
        return jsonify({"error": f"No prediction stored yet for '{ticker}'"}), 404
    return jsonify(col.get(ticker))
