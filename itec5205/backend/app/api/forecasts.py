"""Batch forecasting: LSTM + ARIMA for every ticker of a pool/portfolio.

One Celery task per (ticker, model) is queued straight onto the `lstm` and
`arima` queues, so the two worker types run in parallel and each can be
scaled out independently (`docker compose up --scale worker-lstm=N`). A
`forecast_runs` document records the task ids; progress is aggregated from
their states on read, and the wall-clock duration is stored when the last
task finishes (RQ5 throughput).
"""

import uuid
from datetime import datetime, timezone

from celery.result import AsyncResult
from flask import Blueprint, jsonify, request

from ..db.arango_client import get_db
from ..services.horizons import MAX_HORIZON_DAYS
from ..services.lstm_service import DEFAULT_LOOKBACK_DAYS
from ..services.pool_service import get_pool
from ..services.portfolio_service import get_portfolio
from ..tasks.arima_tasks import train_arima_prediction
from ..tasks.celery_app import celery_app
from ..tasks.predict_tasks import train_lstm_prediction
from ..tasks.stop_flags import request_stop

bp = Blueprint("forecasts", __name__, url_prefix="/api/forecasts")

MODELS = ("lstm", "arima")
DONE_STATES = {"SUCCESS", "FAILURE", "REVOKED"}
STOP_FLAG_TTL = 24 * 60 * 60  # a big run's queued jobs can wait for hours


def resolve_tickers(body: dict) -> tuple[list[str] | None, dict, str | None]:
    """Tickers from `pool_id`, `portfolio_id` or an explicit `tickers` list."""
    if body.get("pool_id"):
        pool = get_pool(body["pool_id"])
        if pool is None:
            return None, {}, "Pool not found"
        return pool["tickers"], {"pool_id": pool["_key"]}, None
    if body.get("portfolio_id"):
        portfolio = get_portfolio(body["portfolio_id"])
        if portfolio is None:
            return None, {}, "Portfolio not found"
        return [h["ticker"] for h in portfolio["holdings"]], {"portfolio_id": portfolio["_key"]}, None
    tickers = body.get("tickers")
    if not tickers:
        return None, {}, "Pass 'pool_id', 'portfolio_id' or 'tickers'"
    return [t.upper() for t in tickers], {}, None


@bp.post("/batch")
def start_batch():
    body = request.get_json(silent=True) or {}
    tickers, source, error = resolve_tickers(body)
    if error:
        return jsonify({"error": error}), 404 if "not found" in error else 400

    lookback = body.get("lookback_days", DEFAULT_LOOKBACK_DAYS)
    lookback = int(lookback) if lookback else None
    epochs = int(body.get("epochs", 100))
    tickers = list(dict.fromkeys(tickers))

    tasks = {"lstm": {}, "arima": {}}
    # Interleaved so both queues start working immediately.
    for ticker in tickers:
        tasks["lstm"][ticker] = train_lstm_prediction.delay(
            ticker=ticker, epochs=epochs, lookback_days=lookback, forecast_days=MAX_HORIZON_DAYS
        ).id
        tasks["arima"][ticker] = train_arima_prediction.delay(
            ticker=ticker, lookback_days=lookback, forecast_days=MAX_HORIZON_DAYS
        ).id

    run = {
        "_key": str(uuid.uuid4()),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "tickers": tickers,
        "params": {"lookback_days": lookback, "epochs": epochs, "forecast_days": MAX_HORIZON_DAYS},
        "tasks": tasks,
        "finished_at": None,
        "wall_seconds": None,
        **source,
    }
    get_db().collection("forecast_runs").insert(run)
    return jsonify(_status(run)), 202


def _status(run: dict) -> dict:
    counts = {}
    errors = []
    train_seconds = {m: [] for m in MODELS}
    for model in MODELS:
        c = {"total": 0, "done": 0, "failed": 0, "running": 0, "pending": 0}
        for ticker, task_id in run["tasks"][model].items():
            res = AsyncResult(task_id, app=celery_app)
            c["total"] += 1
            if res.state == "SUCCESS":
                c["done"] += 1
                seconds = (res.result or {}).get("train_seconds")
                if seconds is not None:
                    train_seconds[model].append(seconds)
            elif res.state in ("FAILURE", "REVOKED"):
                c["failed"] += 1
                errors.append({"ticker": ticker, "model": model, "error": str(res.info)})
            elif res.state in ("STARTED", "PROGRESS"):
                c["running"] += 1
            else:
                c["pending"] += 1
        counts[model] = c

    cancelled = bool(run.get("cancelled_at"))
    finished = cancelled or all(counts[m]["done"] + counts[m]["failed"] == counts[m]["total"] for m in MODELS)
    if finished and not run.get("finished_at"):
        finished_at = datetime.now(timezone.utc)
        run["finished_at"] = finished_at.isoformat()
        run["wall_seconds"] = round((finished_at - datetime.fromisoformat(run["created_at"])).total_seconds(), 2)
        get_db().collection("forecast_runs").update(
            {"_key": run["_key"], "finished_at": run["finished_at"], "wall_seconds": run["wall_seconds"]}
        )

    return {
        "run_id": run["_key"],
        "created_at": run["created_at"],
        "tickers": len(run["tickers"]),
        "params": run["params"],
        "pool_id": run.get("pool_id"),
        "portfolio_id": run.get("portfolio_id"),
        "counts": counts,
        "errors": errors,
        "finished": finished,
        "cancelled": cancelled,
        # Jobs waiting with none of this run's running for that model: they're
        # queued behind other runs' jobs on the same worker queue.
        "queued": not finished and any(counts[m]["pending"] > 0 and counts[m]["running"] == 0 for m in MODELS),
        "finished_at": run.get("finished_at"),
        "wall_seconds": run.get("wall_seconds"),
        "mean_train_seconds": {
            m: round(sum(v) / len(v), 3) if v else None for m, v in train_seconds.items()
        },
    }


@bp.get("/batch/<run_id>")
def batch_status(run_id: str):
    col = get_db().collection("forecast_runs")
    if not col.has(run_id):
        return jsonify({"error": "Forecast run not found"}), 404
    return jsonify(_status(col.get(run_id)))


@bp.get("/batch")
def latest_batch():
    """Most recent run for a pool or portfolio (to resume progress after a reload)."""
    key, value = ("pool_id", request.args.get("pool_id")) if request.args.get("pool_id") else (
        "portfolio_id", request.args.get("portfolio_id"))
    if not value:
        return jsonify({"error": "Pass 'pool_id' or 'portfolio_id'"}), 400
    rows = list(get_db().aql.execute(
        f"FOR r IN forecast_runs FILTER r.{key} == @v SORT r.created_at DESC LIMIT 1 RETURN r",
        bind_vars={"v": value},
    ))
    if not rows:
        return jsonify({"run": None})
    return jsonify({"run": _status(rows[0])})


@bp.post("/batch/<run_id>/cancel")
def cancel_batch(run_id: str):
    """Stop a run: stop its unfinished jobs and mark the run finished. Running
    jobs are terminated (their pool process is killed and replaced); queued ones
    end as soon as a worker picks them up. The Redis stop flag backs up the
    revoke, which workers only keep in memory (lost on restart). Also clears
    runs whose jobs were lost (e.g. a worker restarted while holding them)."""
    col = get_db().collection("forecast_runs")
    if not col.has(run_id):
        return jsonify({"error": "Forecast run not found"}), 404
    run = col.get(run_id)
    unfinished = [
        task_id
        for model in MODELS
        for task_id in run["tasks"][model].values()
        if AsyncResult(task_id, app=celery_app).state not in DONE_STATES
    ]
    for task_id in unfinished:
        request_stop(task_id, ttl=STOP_FLAG_TTL)
    if unfinished:
        celery_app.control.revoke(unfinished, terminate=True)
    run["cancelled_at"] = datetime.now(timezone.utc).isoformat()
    col.update({"_key": run_id, "cancelled_at": run["cancelled_at"]})
    return jsonify(_status(run))
