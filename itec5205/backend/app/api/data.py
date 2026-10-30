"""Trigger the bulk Yahoo Finance -> ArangoDB import job and check on it.

Progress is pushed live over Socket.IO to the room named after the returned
``task_id`` (event ``import_progress``); poll ``/import/status`` as a
fallback.
"""

from datetime import datetime, timezone

from celery.result import AsyncResult
from flask import Blueprint, jsonify, request

from ..db.arango_client import get_db
from ..services.delisting import clear_delisted, list_delisted, purge_ticker
from ..services.universes import INDEXES, existing_mode, normalize_universe, imported_tickers, tickers_to_import, universe_tickers
from ..services.yahoo_import import _last_closed_session_date
from ..tasks.celery_app import celery_app
from ..tasks.import_tasks import import_sp500_data
from ..tasks.stop_flags import request_stop

bp = Blueprint("data", __name__, url_prefix="/api/data")


@bp.post("/import")
def trigger_import():
    """Body: `tickers` (a list -> scope "specific"), else `universe`
    ("all" default = both indexes + every imported company | "sp500" |
    "russell3000"); `existing` ("skip" | "update" |
    "reimport", see services/universes.py; older clients send `only_missing`)."""
    body = request.get_json(silent=True) or {}
    tickers = body.get("tickers")
    scope = "specific" if tickers else "all"
    try:
        universe = normalize_universe(body.get("universe"))
        if not tickers:
            tickers = universe_tickers(universe)
        existing = existing_mode(body)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    tickers = list(dict.fromkeys(t.upper() for t in tickers))

    import_history = bool(body.get("import_history", True))
    import_statistics = bool(body.get("import_statistics", True))
    import_calculated_stats = bool(body.get("import_calculated_stats", True))
    import_earnings = bool(body.get("import_earnings", False))

    requested = len(tickers)
    tickers, existing = tickers_to_import(tickers, existing, import_history)
    if not tickers:
        last = _last_closed_session_date()
        message = (f"All {requested:,} companies are up to date through {last:%b} {last.day}, {last.year} "
                   "(a day's close is fetched after 4:30 PM ET).")
        return jsonify({"task_id": None, "ticker_count": 0, "requested": requested, "message": message}), 200

    task = import_sp500_data.delay(
        tickers=tickers,
        years=int(body.get("years", 10)),
        interval=body.get("interval", "1d"),
        import_history=import_history,
        import_statistics=import_statistics,
        import_calculated_stats=import_calculated_stats,
        import_earnings=import_earnings,
        scope=scope,
        source="manual",
        universe=universe if scope == "all" else None,
        skipped=max(requested - len(tickers), 0),
        existing=existing,
    )
    return jsonify({"task_id": task.id, "ticker_count": len(tickers), "requested": requested,
                    "skipped": max(requested - len(tickers), 0)}), 202


@bp.get("/imports")
def recent_imports():
    """Import history, newest first (``?limit=``, default 8, max 200). A run
    still marked running whose task is gone (worker restarted) is shown as
    failed."""
    limit = max(1, min(int(request.args.get("limit", 8)), 200))
    db = get_db()
    total = db.collection("import_runs").count()
    runs = list(db.aql.execute(
        # failed_errors holds every failure (thousands on a bad run); the
        # list carries the first 25, GET /imports/<key> the whole run.
        "FOR r IN import_runs SORT r.created_at DESC LIMIT @n "
        "RETURN MERGE(UNSET(r, '_id', '_rev'), r.failed_errors ? {failed_errors: SLICE(r.failed_errors, 0, 25)} : {})",
        bind_vars={"n": limit},
    ))
    for run in runs:
        if run["status"] == "running" and AsyncResult(run["_key"], app=celery_app).state in ("FAILURE", "REVOKED"):
            run["status"] = "failed"
            db.collection("import_runs").update({"_key": run["_key"], "status": "failed"})
    return jsonify({"runs": runs, "total": total})


@bp.get("/imports/<key>")
def import_run(key):
    """One import run with every failed ticker and its error."""
    run = get_db().collection("import_runs").get(key)
    if not run:
        return jsonify({"error": "Import not found"}), 404
    return jsonify({k: v for k, v in run.items() if k not in ("_id", "_rev")})


@bp.delete("/imports/<key>")
def delete_import_run(key):
    """Remove a run from the import history (the imported data stays)."""
    col = get_db().collection("import_runs")
    run = col.get(key)
    if not run:
        return jsonify({"error": "Import not found"}), 404
    if run.get("status") == "running":
        return jsonify({"error": "Stop the import before deleting it"}), 409
    col.delete(key)
    return jsonify({"deleted": key})


@bp.get("/delisted")
def delisted():
    """Companies on the delisted list: removed from the database and left
    out of every whole-list import."""
    return jsonify({"delisted": list_delisted()})


@bp.post("/delisted")
def add_delisted():
    """Body: `tickers` (list or comma-separated text), optional `reason`.
    Removes each company's data and adds it to the delisted list."""
    body = request.get_json(silent=True) or {}
    tickers = body.get("tickers") or []
    if isinstance(tickers, str):
        tickers = tickers.split(",")
    tickers = list(dict.fromkeys(t.strip().upper() for t in tickers if t and t.strip()))
    if not tickers:
        return jsonify({"error": "List the tickers to mark as delisted"}), 400
    reason = (body.get("reason") or "").strip() or "Marked delisted by the user"
    for ticker in tickers:
        purge_ticker(ticker, reason, source="manual")
    return jsonify({"delisted": list_delisted()}), 201


@bp.delete("/delisted/<ticker>")
def remove_delisted(ticker: str):
    """Take a company off the delisted list; the next import that covers it
    imports it again."""
    clear_delisted(ticker.upper())
    return jsonify({"delisted": list_delisted()})


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
    have = imported_tickers()
    universes = {}
    for key, u in INDEXES.items():
        try:
            listed = universe_tickers(key)
        except OSError:
            continue  # list file not mounted
        universes[key] = {"label": u["label"], "size": len(listed), "imported": sum(1 for t in listed if t in have)}
    universe, in_universe = universes["sp500"]["size"], universes["sp500"]["imported"]
    return jsonify({
        "universe": universe,
        "in_universe": in_universe,  # of the S&P 500 list, how many are imported
        "universes": universes,  # {sp500|russell3000: {label, size, imported}}
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
        import_earnings=prior.get("import_earnings", False),
    )
    return jsonify({"task_id": task.id, "ticker_count": len(remaining)}), 202
