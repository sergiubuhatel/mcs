"""Trigger the bulk Yahoo Finance -> ArangoDB import job and check on it.

Progress is pushed live over Socket.IO to the room named after the returned
``task_id`` (event ``import_progress``); poll ``/import/status`` as a
fallback.
"""

from datetime import datetime, timezone

from celery.result import AsyncResult
from flask import Blueprint, jsonify, request

from .. import config
from ..db.arango_client import get_db
from ..services.yahoo_import import _last_closed_session_date, get_up_to_date_tickers, read_tickers
from ..tasks.celery_app import celery_app
from ..tasks.import_tasks import import_sp500_data
from ..tasks.stop_flags import request_stop

bp = Blueprint("data", __name__, url_prefix="/api/data")


@bp.post("/import")
def trigger_import():
    body = request.get_json(silent=True) or {}
    tickers = body.get("tickers")
    scope = "specific" if tickers else "all"
    if not tickers:
        tickers = read_tickers(config.TICKERS_FILE)
    tickers = [t.upper() for t in tickers]

    import_history = bool(body.get("import_history", True))
    import_statistics = bool(body.get("import_statistics", True))
    import_calculated_stats = bool(body.get("import_calculated_stats", True))

    # "Only missing" is defined by price-history gaps, which is meaningless
    # for a statistics-only run (a live snapshot field has no notion of a
    # missing day) -- only apply it when history is actually being pulled.
    if body.get("only_missing") and import_history:
        up_to_date = get_up_to_date_tickers()
        tickers = [t for t in tickers if t not in up_to_date]
        if not tickers:
            return jsonify({"task_id": None, "ticker_count": 0, "message": "Everything requested is already imported."}), 200

    task = import_sp500_data.delay(
        tickers=tickers,
        years=int(body.get("years", 10)),
        interval=body.get("interval", "1d"),
        import_history=import_history,
        import_statistics=import_statistics,
        import_calculated_stats=import_calculated_stats,
        scope=scope,
        source="manual",
    )
    return jsonify({"task_id": task.id, "ticker_count": len(tickers)}), 202


@bp.get("/imports")
def recent_imports():
    """Import history, newest first (``?limit=``, default 8, max 200). A run
    still marked running whose task is gone (worker restarted) is shown as
    failed."""
    limit = max(1, min(int(request.args.get("limit", 8)), 200))
    db = get_db()
    total = db.collection("import_runs").count()
    runs = list(db.aql.execute(
        "FOR r IN import_runs SORT r.created_at DESC LIMIT @n RETURN UNSET(r, '_id', '_rev')",
        bind_vars={"n": limit},
    ))
    for run in runs:
        if run["status"] == "running" and AsyncResult(run["_key"], app=celery_app).state in ("FAILURE", "REVOKED"):
            run["status"] = "failed"
            db.collection("import_runs").update({"_key": run["_key"], "status": "failed"})
    return jsonify({"runs": runs, "total": total})


@bp.get("/summary")
def data_summary():
    """What's stored: companies, price rows, date range, and how many tickers
    are up to date with the last closed session -- one pass over prices."""
    db = get_db()
    cutoff = _last_closed_session_date().isoformat()
    per_ticker = list(db.aql.execute(
        """
        FOR p IN stock_prices
            COLLECT t = p.ticker AGGREGATE n = COUNT(1), first = MIN(p.date), last = MAX(p.date)
            RETURN {n, first, last}
        """
    ))
    last_run = next(iter(db.aql.execute(
        "FOR r IN import_runs FILTER r.status != 'running' SORT r.created_at DESC LIMIT 1 "
        "RETURN {finished_at: r.finished_at, status: r.status}"
    )), None)
    universe = read_tickers(config.TICKERS_FILE)
    in_universe = next(iter(db.aql.execute(
        "RETURN LENGTH(FOR c IN companies FILTER c._key IN @t RETURN 1)", bind_vars={"t": universe}
    )))
    return jsonify({
        "universe": len(universe),
        "in_universe": in_universe,  # of the S&P 500 list, how many are imported
        "companies": db.collection("companies").count(),  # can exceed it: tickers that left the index stay
        "tickers_with_prices": len(per_ticker),
        "price_rows": sum(r["n"] for r in per_ticker),
        "first_date": min((r["first"] for r in per_ticker), default=None),
        "last_date": max((r["last"] for r in per_ticker), default=None),
        "up_to_date": sum(1 for r in per_ticker if r["last"] >= cutoff),
        "last_session": cutoff,
        "last_import": last_run,
        "as_of": datetime.now(timezone.utc).isoformat(),
    })


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
        source="resume",
        scope="specific",
        tickers=remaining,
        years=prior.get("years", 10),
        interval=prior.get("interval", "1d"),
        import_history=prior.get("import_history", True),
        import_statistics=prior.get("import_statistics", True),
        import_calculated_stats=prior.get("import_calculated_stats", True),
    )
    return jsonify({"task_id": task.id, "ticker_count": len(remaining)}), 202
