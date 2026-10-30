"""Who is signed in and what each user did (Dashboard page).

* `user_sessions` (`_key` = Keycloak user id): updated by the browser's
  heartbeat (every 30 s and on every page change) with the page it shows.
  A user is online while heartbeats keep arriving and they haven't logged out
  or closed the app (the browser sends a "leave" beacon when the tab closes).
* `user_activity`: one document per change a user made through the API
  (recorded by `record_request`, an after_request hook), with a link to the
  job it started -- import, forecast run, LSTM/ARIMA, RL, workflow run -- whose
  live status is read when the Dashboard asks.
"""

import logging
import time
from datetime import datetime, timedelta, timezone

import numpy as np
from celery.result import AsyncResult
from flask import request

from ..auth import current_user
from ..db.arango_client import get_db
from ..extensions import notify_dashboard
from ..tasks.celery_app import celery_app

log = logging.getLogger(__name__)

ONLINE_SECONDS = 75  # 2 missed heartbeats (every 30 s) -> offline
LEAVE_GRACE = timedelta(seconds=5)
RESULT_EXPIRY = timedelta(days=1)  # Celery forgets results after a day


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _client_ip() -> str | None:
    # Behind cloudflared + 2 nginx: the first X-Forwarded-For entry is the browser.
    forwarded = request.headers.get("CF-Connecting-IP") or request.headers.get("X-Forwarded-For", "")
    return forwarded.split(",")[0].strip() or request.remote_addr


# ------------------------------------------------------------------ sessions

def heartbeat(user: dict, page: str | None) -> None:
    col = get_db().collection("user_sessions")
    now = _now().isoformat()
    doc = {"_key": user["id"], "username": user["username"], "name": user["name"], "roles": user["roles"],
           "last_seen": now, "page": page, "ip": _client_ip(), "sid": user.get("sid"),
           "logged_out_at": None, "left_at": None}
    if col.has(user["id"]):
        old = col.get(user["id"])
        # A heartbeat still in flight from a session that just logged out.
        if old.get("logged_out_sid") and old["logged_out_sid"] == user.get("sid"):
            return
        # A new sign-in after a logout (or a long absence) starts a new session.
        came_online = bool(old.get("logged_out_at")) or not _is_online(old)
        if came_online:
            doc["signed_in_at"] = now
        col.update(doc, keep_none=True)
        if came_online or old.get("page") != page:
            notify_dashboard(force=True)
    else:
        col.insert({**doc, "first_seen": now, "signed_in_at": now})
        notify_dashboard(force=True)


def logout(user: dict) -> None:
    col = get_db().collection("user_sessions")
    if col.has(user["id"]):
        col.update({"_key": user["id"], "logged_out_at": _now().isoformat(), "logged_out_sid": user.get("sid")})
        notify_dashboard(force=True)


def leave(user: dict) -> None:
    """The tab was closed: offline now, unless another tab of theirs heartbeats.
    A reload's beacon can land just after the new page's first heartbeat, so a
    leave within LEAVE_GRACE of a heartbeat is ignored."""
    col = get_db().collection("user_sessions")
    if col.has(user["id"]):
        last = datetime.fromisoformat(col.get(user["id"])["last_seen"])
        if _now() - last < LEAVE_GRACE:
            return
        col.update({"_key": user["id"], "left_at": _now().isoformat()})
        notify_dashboard(force=True)


def _is_online(session: dict) -> bool:
    if session.get("logged_out_at"):
        return False
    if session.get("left_at") and session["left_at"] >= session["last_seen"]:
        return False
    last = datetime.fromisoformat(session["last_seen"])
    return _now() - last < timedelta(seconds=ONLINE_SECONDS)


# ------------------------------------------------------------------ activity

def _ticker(body, resp):
    return (body.get("ticker") or "").upper()


def _count(key, noun):
    return lambda body, resp: f"{resp.get(key):,} {noun}" if isinstance(resp.get(key), int) else ""


def _name(body, resp):
    return resp.get("name") or body.get("name") or ""


# endpoint -> (kind, action, details(body, response) -> str, job type).
# Job type says how the response names the job it started (see _job_status).
ACTIONS = {
    "data.trigger_import": ("import", "Started a data import", _count("ticker_count", "companies"), "import"),
    "data.resume_import": ("import", "Resumed a data import", _count("ticker_count", "companies"), "import"),
    "data.stop_import": ("import", "Stopped a data import", None, None),
    "data.delete_import_run": ("import", "Deleted an import from the history", None, None),
    "data.add_delisted": ("import", "Marked companies delisted", None, None),
    "data.remove_delisted": ("import", "Un-marked a delisted company", None, None),
    "forecasts.start_batch": ("forecast", "Ran forecasts (LSTM + ARIMA)", _count("tickers", "companies"), "forecast_run"),
    "forecasts.cancel_batch": ("forecast", "Cancelled a forecast run", None, None),
    "predictions.train": ("forecast", "Trained an LSTM forecast", _ticker, "task"),
    "arima.train": ("forecast", "Trained an ARIMA forecast", _ticker, "task"),
    "rl.train": ("rl", "Built an RL portfolio", lambda b, r: b.get("portfolio_name") or "", "task"),
    "workflows.workflow_run": ("workflow", "Ran a workflow", lambda b, r: r.get("workflow_name") or "", "workflow_run"),
    "workflows.run_cancel": ("workflow", "Cancelled a workflow run", lambda b, r: r.get("workflow_name") or "", None),
    "workflows.workflow_create": ("workflow", "Created a workflow", _name, None),
    "workflows.workflow_update": ("workflow", "Edited a workflow", _name, None),
    "workflows.workflow_duplicate": ("workflow", "Duplicated a workflow", _name, None),
    "workflows.workflow_delete": ("workflow", "Deleted a workflow", None, None),
    "workflows.criteria_create": ("workflow", "Created criteria", _name, None),
    "workflows.criteria_update": ("workflow", "Edited criteria", _name, None),
    "workflows.criteria_set_default": ("workflow", "Set default criteria", _name, None),
    "workflows.criteria_duplicate": ("workflow", "Duplicated criteria", _name, None),
    "workflows.criteria_delete": ("workflow", "Deleted criteria", None, None),
    "pools.create": ("pool", "Created a stock pool", _name, None),
    "pools.update": ("pool", "Edited a stock pool", _name, None),
    "pools.delete": ("pool", "Deleted a stock pool", None, None),
    "pools.refine": ("pool", "Refined a stock pool", _name, None),
    "portfolios.create": ("portfolio", "Created a portfolio", _name, None),
    "portfolios.create_combined": ("portfolio", "Combined portfolios", _name, None),
    "portfolios.update_combined": ("portfolio", "Edited a combined portfolio", _name, None),
    "portfolios.import_image": ("portfolio", "Imported a portfolio from a screenshot", None, None),
    "portfolios.update": ("portfolio", "Edited a portfolio", _name, None),
    "portfolios.delete": ("portfolio", "Deleted a portfolio", None, None),
    "orders.save_plan": ("trading", "Saved the order plan", None, None),
    "settings.save_settings": ("settings", "Changed the settings", None, None),
    "settings.reset_settings": ("settings", "Reset the settings", None, None),
    "backup.import_all": ("backup", "Imported the whole database", None, None),
    "backup.export_all": ("backup", "Exported the whole database", None, None),
    "backup.delete_all": ("backup", "Deleted all data", None, None),
}


def _job_ref(job_type: str | None, resp: dict) -> dict | None:
    if job_type in ("import", "task") and resp.get("task_id"):
        return {"type": job_type, "id": resp["task_id"]}
    if job_type == "forecast_run" and resp.get("run_id"):
        return {"type": job_type, "id": resp["run_id"]}
    if job_type == "workflow_run" and resp.get("_key"):
        return {"type": job_type, "id": resp["_key"]}
    return None


def record_request(response):
    """after_request hook: log successful changes made by a signed-in user."""
    try:
        action = ACTIONS.get(request.endpoint or "")
        if action is None or response.status_code >= 400:
            return response
        user = current_user()
        if user is None:
            return response
        kind, label, details, job_type = action
        body = request.get_json(silent=True) if request.is_json else None
        body = body if isinstance(body, dict) else {}
        resp = response.get_json(silent=True) if response.is_json else None
        resp = resp if isinstance(resp, dict) else {}
        get_db().collection("user_activity").insert({
            "created_at": _now().isoformat(),
            "user_id": user["id"],
            "username": user["username"],
            "name": user["name"],
            "kind": kind,
            "action": label,
            "details": details(body, resp) if details else "",
            "job": _job_ref(job_type, resp),
        })
        notify_dashboard(force=True)
    except Exception:  # never fail the user's request over the activity log
        log.exception("Could not record activity")
    return response


# ----------------------------------------------------------------- job status

_FINAL = {"done", "failed", "stopped", "cancelled"}


def _task_status(task_id: str, created_at: datetime) -> tuple[str, int | None]:
    res = AsyncResult(task_id, app=celery_app)
    state = res.state
    if state == "SUCCESS":
        result = res.result if isinstance(res.result, dict) else {}
        return ("stopped" if result.get("remaining_tickers") else "done"), 100
    if state in ("FAILURE", "REVOKED"):
        return "failed", None
    if state in ("STARTED", "PROGRESS"):
        info = res.info if isinstance(res.info, dict) else {}
        total = info.get("total")
        done = info.get("completed")
        return "running", round(100 * done / total) if total and done is not None else None
    # PENDING: queued -- or forgotten by Celery once the result expired.
    return ("unknown" if _now() - created_at > RESULT_EXPIRY else "queued"), None


_IMPORT_STATUS = {"completed": "done", "completed_with_failures": "done", "stopped": "stopped", "failed": "failed"}


def _job_status(job: dict, created_at: datetime) -> tuple[str, int | None]:
    db = get_db()
    if job["type"] == "import":
        # The import task records its own outcome in import_runs (kept for good).
        run = db.collection("import_runs").get(job["id"]) if db.collection("import_runs").has(job["id"]) else None
        if run and run.get("status") in _IMPORT_STATUS:
            return _IMPORT_STATUS[run["status"]], 100 if run["status"] != "failed" else None
        return _task_status(job["id"], created_at)
    if job["type"] == "forecast_run":
        from ..api.forecasts import _status  # noqa: PLC0415 - avoid an import cycle

        if not db.collection("forecast_runs").has(job["id"]):
            return "unknown", None
        s = _status(db.collection("forecast_runs").get(job["id"]))
        total = sum(c["total"] for c in s["counts"].values())
        done = sum(c["done"] + c["failed"] for c in s["counts"].values())
        percent = round(100 * done / total) if total else None
        if s["cancelled"]:
            return "cancelled", percent
        if s["finished"]:
            return ("done" if any(c["done"] for c in s["counts"].values()) else "failed"), 100
        return ("running" if done or any(c["running"] for c in s["counts"].values()) else "queued"), percent
    if job["type"] == "workflow_run":
        from ..api.workflows import _reconcile  # noqa: PLC0415

        if not db.collection("workflow_runs").has(job["id"]):
            return "unknown", None
        run = _reconcile(db.collection("workflow_runs").get(job["id"]))
        # queued/running/succeeded/failed/cancelled
        return {"succeeded": "done", "done": "done"}.get(run["status"], run["status"]), run.get("percent")
    return _task_status(job["id"], created_at)


_RUN_COLLECTIONS = {"import": "import_runs", "forecast_run": "forecast_runs", "workflow_run": "workflow_runs"}


def _duration(job: dict, created_at: datetime) -> float | None:
    """How long a finished job took: the run's own wall time when it keeps
    one, else Celery's finish time."""
    db = get_db()
    col = _RUN_COLLECTIONS.get(job["type"])
    if col and db.collection(col).has(job["id"]):
        seconds = db.collection(col).get(job["id"]).get("wall_seconds")
        if seconds is not None:
            return seconds
    done = AsyncResult(job["id"], app=celery_app).date_done if job["type"] in ("import", "task") else None
    if done is None:
        return None
    done = done if done.tzinfo else done.replace(tzinfo=timezone.utc)
    return round((done - created_at).total_seconds(), 1)


def _with_status(doc: dict) -> dict:
    job = doc.get("job")
    if not job:
        return doc
    if doc.get("final_status"):
        return {**doc, "status": doc["final_status"], "percent": None}
    created_at = datetime.fromisoformat(doc["created_at"])
    try:
        status, percent = _job_status(job, created_at)
    except Exception:
        log.exception("Job status for %s", job)
        status, percent = "unknown", None
    if status in _FINAL:  # remember it: Celery forgets results after a day
        try:
            seconds = _duration(job, created_at)
        except Exception:
            seconds = None
        get_db().collection("user_activity").update(
            {"_key": doc["_key"], "final_status": status, "duration_seconds": seconds}
        )
        doc = {**doc, "duration_seconds": seconds}
    return {**doc, "status": status, "percent": percent}


# ------------------------------------------------------------------ dashboard

def dashboard(limit: int = 100) -> dict:
    db = get_db()
    sessions = list(db.aql.execute("FOR s IN user_sessions SORT s.last_seen DESC RETURN s"))
    since = (_now() - timedelta(days=1)).isoformat()
    recent = list(db.aql.execute(
        "FOR a IN user_activity SORT a.created_at DESC LIMIT @limit RETURN a", bind_vars={"limit": limit}
    ))
    # Jobs still running may be older than the recent list: include them.
    open_jobs = list(db.aql.execute(
        "FOR a IN user_activity FILTER a.job != null AND a.final_status == null "
        "AND a.created_at >= @since SORT a.created_at DESC RETURN a",
        bind_vars={"since": since},
    ))
    by_key = {a["_key"]: a for a in open_jobs + recent}
    activity = sorted((_with_status(a) for a in by_key.values()), key=lambda a: a["created_at"], reverse=True)

    per_user = {}
    for row in db.aql.execute(
        "FOR a IN user_activity COLLECT user = a.user_id, kind = a.kind WITH COUNT INTO n RETURN {user, kind, n}"
    ):
        per_user.setdefault(row["user"], {})[row["kind"]] = row["n"]
    running = {}
    for a in activity:
        if a.get("status") in ("running", "queued"):
            running[a["user_id"]] = running.get(a["user_id"], 0) + 1

    users = [
        {
            "id": s["_key"], "username": s["username"], "name": s["name"], "roles": s.get("roles", []),
            "online": _is_online(s), "page": s.get("page"), "last_seen": s["last_seen"],
            "signed_in_at": s.get("signed_in_at"), "ip": s.get("ip"),
            "counts": per_user.get(s["_key"], {}), "running": running.get(s["_key"], 0),
        }
        for s in sessions
    ]
    today = _now().replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    actions_today = next(db.aql.execute(
        "RETURN LENGTH(FOR a IN user_activity FILTER a.created_at >= @today RETURN 1)", bind_vars={"today": today}
    ))
    return {
        "users": users,
        "activity": activity[:limit],
        "stats": {
            "online": sum(u["online"] for u in users),
            "users": len(users),
            "running": sum(1 for a in activity if a.get("status") in ("running", "queued")),
            "actions_today": actions_today,
        },
    }


# ------------------------------------------------------------------- overview
# The Dashboard's top half: totals with 14-day trends, a portfolio against
# the S&P 500 / the Dow / other portfolios (its own endpoint),
# the latest workflow run and worker health.
# Heavier than `dashboard()` (price history), so cached briefly.

BENCHMARK_LABELS = {"portfolio": "Portfolio", "SPY": "S&P 500 (SPY)", "DIA": "Dow Jones (DIA)"}
TREND_DAYS = 14
HISTORY_DAYS = 2520  # ~10 years of trading days: the chart's longest range
_OVERVIEW_TTL = 20  # seconds
_overview_cache: dict = {"at": 0.0, "data": None}
_workers_cache: dict = {"at": 0.0, "data": None}


def _per_day(collection: str, extra_filter: str = "") -> list[dict]:
    """Documents created per day over the last TREND_DAYS days (oldest first)."""
    start = (_now() - timedelta(days=TREND_DAYS - 1)).date()
    rows = {
        r["day"]: r["n"]
        for r in get_db().aql.execute(
            f"FOR d IN {collection} FILTER d.created_at >= @start {extra_filter} "
            "COLLECT day = SUBSTRING(d.created_at, 0, 10) WITH COUNT INTO n RETURN {day, n}",
            bind_vars={"start": start.isoformat()},
        )
    }
    days = [(start + timedelta(days=i)).isoformat() for i in range(TREND_DAYS)]
    return [{"day": d, "n": rows.get(d, 0)} for d in days]


_PERF_TTL = 60  # seconds; prices change once a day
_perf_cache: dict = {}


def _get_portfolio(db, key: str | None) -> dict | None:
    if key and db.collection("portfolios").has(key):
        p = db.collection("portfolios").get(key)
        return p if p.get("holdings") else None
    return None


def portfolio_performance(portfolio_id: str | None = None, compare_ids: list[str] = ()) -> dict | None:
    """A portfolio (default: the newest) against the market benchmarks
    (S&P 500 / Dow ETFs) and any other portfolios to compare, over up to HISTORY_DAYS. The page cuts the range
    picked and rebases every line to 100 at its start. A holding without
    prices yet on a day counts as a 0% return that day."""
    from .portfolio_service import _returns_matrix  # noqa: PLC0415
    from .universes import BENCHMARKS  # noqa: PLC0415

    cache_key = (portfolio_id, tuple(compare_ids))
    hit = _perf_cache.get(cache_key)
    if hit and time.monotonic() - hit[0] < _PERF_TTL:
        return hit[1]

    db = get_db()
    main = _get_portfolio(db, portfolio_id)
    if main is None:
        rows = list(db.aql.execute(
            "FOR p IN portfolios FILTER LENGTH(p.holdings) > 0 SORT p.created_at DESC LIMIT 1 RETURN p"
        ))
        if not rows:
            return None
        main = rows[0]
    others = [o for o in (_get_portfolio(db, k) for k in dict.fromkeys(compare_ids)) if o and o["_key"] != main["_key"]]

    def weights_of(p):
        return [h["ticker"] for h in p["holdings"]], np.array([h["weight"] for h in p["holdings"]], dtype=float)

    every = [h["ticker"] for p in [main, *others] for h in p["holdings"]]
    returns = _returns_matrix(list(dict.fromkeys(every + list(BENCHMARKS))), lookback_days=HISTORY_DAYS)
    if returns.empty:
        return None
    returns = returns.fillna(0.0)

    def daily_of(p):
        tickers, weights = weights_of(p)
        return returns.reindex(columns=tickers).fillna(0.0).values @ weights

    tickers, _ = weights_of(main)
    daily = {"portfolio": daily_of(main)}
    labels = dict(BENCHMARK_LABELS)
    for b in BENCHMARKS:  # a benchmark not imported (yet) has no line
        if b in returns.columns and returns[b].abs().sum() > 0:
            daily[b] = returns[b].values
    for o in others:
        daily[f"p_{o['_key']}"] = daily_of(o)
        labels[f"p_{o['_key']}"] = o["name"]
    lines = {key: 100 * np.cumprod(1 + r) for key, r in daily.items()}
    data = {
        "id": main["_key"],
        "name": main["name"],
        "method": main.get("method"),
        "created_at": main.get("created_at"),
        "holdings": len(tickers),
        "lines": [{"key": key, "label": labels.get(key, key), "compare": key.startswith("p_")} for key in lines],
        "series": [
            {"date": str(d)[:10], **{key: round(float(v[i]), 2) for key, v in lines.items()}}
            for i, d in enumerate(returns.index)
        ],
    }
    _perf_cache[cache_key] = (time.monotonic(), data)
    return data


# Per-user Dashboard choices (stored on the user's session document).
_PREF_KEYS = ("portfolio_id", "compare_ids")


def get_preferences(user: dict) -> dict:
    col = get_db().collection("user_sessions")
    doc = col.get(user["id"]) if col.has(user["id"]) else None
    return (doc or {}).get("dashboard") or {}


def save_preferences(user: dict, prefs: dict) -> dict:
    clean = {k: prefs.get(k) for k in _PREF_KEYS}
    clean["compare_ids"] = [str(k) for k in (clean.get("compare_ids") or [])]
    col = get_db().collection("user_sessions")
    if col.has(user["id"]):
        col.update({"_key": user["id"], "dashboard": clean}, merge=False)
    return clean


def _latest_workflow_run() -> dict | None:
    from ..api.workflows import _reconcile  # noqa: PLC0415

    rows = list(get_db().aql.execute("FOR r IN workflow_runs SORT r.created_at DESC LIMIT 1 RETURN r"))
    if not rows:
        return None
    run = _reconcile(rows[0])
    keys = ("_key", "workflow_id", "workflow_name", "status", "step", "percent", "message",
            "created_at", "finished_at", "wall_seconds", "pool_id", "portfolio_id", "steps")
    return {k: run.get(k) for k in keys}


def _workers() -> dict:
    """Celery workers answering a ping (cached: a ping waits up to a second)."""
    if _workers_cache["data"] is None or time.monotonic() - _workers_cache["at"] > 30:
        try:
            replies = celery_app.control.ping(timeout=1.0)
            names = sorted(name.split("@")[0] for reply in replies for name in reply)
        except Exception:
            names = []
        _workers_cache.update(at=time.monotonic(), data={"online": len(names), "names": names})
    return _workers_cache["data"]


def overview() -> dict:
    if _overview_cache["data"] is not None and time.monotonic() - _overview_cache["at"] < _OVERVIEW_TTL:
        return _overview_cache["data"]
    db = get_db()
    data = {
        "totals": {name: db.collection(name).count() for name in ("companies", "pools", "portfolios", "workflows")},
        "trends": {
            "imports": _per_day("import_runs"),
            "pools": _per_day("pools"),
            "portfolios": _per_day("portfolios"),
            "jobs": _per_day("user_activity", "FILTER d.job != null"),
        },
        "workflow_run": _latest_workflow_run(),
        "workers": _workers(),
    }
    _overview_cache.update(at=time.monotonic(), data=data)
    return data


# ------------------------------------------------------------ running jobs
# The bottom bar (every page, every user) shows these with their progress, and
# a user can't start an import / forecast while someone else's is running.

_RUNNING_TTL = 1.5  # seconds; every open page refetches on each progress ping
_running_cache: dict = {"at": 0.0, "data": None}
_RUNNING_FIELDS = ("_key", "kind", "action", "details", "user_id", "username", "name", "created_at", "status", "percent")
VERBS = {"import": "importing data", "forecast": "running forecasts", "rl": "building an RL portfolio", "workflow": "running a workflow"}


def running_jobs() -> list[dict]:
    """Jobs started in the last day that are queued or running, newest first."""
    if _running_cache["data"] is not None and time.monotonic() - _running_cache["at"] < _RUNNING_TTL:
        return _running_cache["data"]
    docs = get_db().aql.execute(
        "FOR a IN user_activity FILTER a.job != null AND a.final_status == null AND a.created_at >= @since "
        "SORT a.created_at DESC RETURN a",
        bind_vars={"since": (_now() - timedelta(days=1)).isoformat()},
    )
    jobs = [
        {k: d.get(k) for k in _RUNNING_FIELDS}
        for d in map(_with_status, docs)
        if d.get("status") in ("running", "queued")
    ]
    _running_cache.update(at=time.monotonic(), data=jobs)
    return jobs


def busy_by_others(kind: str, user: dict | None) -> str | None:
    """Why `user` can't start a `kind` job now (someone else's is running), or None."""
    me = user["id"] if user else None
    for job in running_jobs():
        if job["kind"] == kind and job["user_id"] != me:
            return f"{job['name'] or job['username']} is {VERBS.get(kind, 'running a job')} -- try again when it finishes"
    return None


def refuse_if_busy(kind: str):
    """A 409 response when another user's `kind` job is running, else None."""
    from flask import jsonify  # noqa: PLC0415

    reason = busy_by_others(kind, current_user())
    return (jsonify({"error": reason, "busy": True}), 409) if reason else None
