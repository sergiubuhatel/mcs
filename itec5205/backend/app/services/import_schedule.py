"""Automatic (scheduled) data import, edited on the Settings page.

The schedule is one document, `settings/import_schedule`:

    schedule       "off" | "daily@HH:MM[,HH:MM...]" (Ottawa time) | "every:N" (hours after
                   the last import started)
    trading_days   daily only: run only when there is a new close to fetch
                   (a run before noon fetches the previous day's close, so
                   1:00 AM runs Tuesday-Saturday)
    universe       companies to import: "russell3000" (default) | "sp500" | "all"

Default: every day at 1:00 AM, 5:00 PM and 6:00 PM, the whole Russell 3000. The other options
(already-imported mode, history years, the four import options) are the
Settings page's Data Defaults (`settings/app` -> values.data), the same values
the Market Data form opens with.

A daemon thread in the backend process (`start()`, called from wsgi.py)
checks every 30 s whether an import is due and starts the normal
`import_sp500_data` Celery task with source "scheduled". A Redis lock makes
sure only one backend process runs the loop. Like the listings app's
scheduler, a daily import is due once today's time has passed and no import
(of any kind) has started since then; "every N hours" is due N hours after
the last import started. An import already running (anyone's, or a
workflow's) postpones it until that one finishes.
"""

from __future__ import annotations

import logging
import re
import threading
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import redis

from ..config import REDIS_URL
from ..db.arango_client import get_db

log = logging.getLogger(__name__)

OTTAWA = ZoneInfo("America/Toronto")
COLLECTION = "settings"
KEY = "import_schedule"
TICK_SECONDS = 30
LOCK_KEY = "import_scheduler:leader"
EVERY_HOURS = (1, 2, 3, 4, 6, 8, 12, 24)
DEFAULT = {"schedule": "daily@01:00,17:00,18:00", "trading_days": True, "universe": "russell3000"}
# Same built-in Data Defaults as frontend/src/features/settings/settings.js.
DATA_DEFAULTS = {"universe": "all", "years": 10, "existing": "skip", "import_history": True,
                 "import_statistics": True, "import_calculated_stats": True, "import_earnings": True}
SCHEDULER_USER = {"id": "scheduler", "username": "scheduler", "name": "Automatic import"}

state = {"alive": False, "beat": None, "leader": False, "last_message": None}
_started = False
_redis = redis.from_url(REDIS_URL)


# ------------------------------------------------------------------ storage

def _collection():
    db = get_db()
    if not db.has_collection(COLLECTION):
        db.create_collection(COLLECTION)
    return db.collection(COLLECTION)


def validate_schedule(value) -> str:
    v = str(value or "").strip()
    if v == "off":
        return v
    m = re.fullmatch(r"daily@(.+)", v)
    if m:
        times = sorted({t.strip() for t in m.group(1).split(",") if t.strip()})
        if times and len(times) <= 12 and all(re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", t) for t in times):
            return "daily@" + ",".join(times)
        raise ValueError("daily times must be HH:MM, comma-separated (at most 12)")
    m = re.fullmatch(r"every:(\d+)", v)
    if m and int(m.group(1)) in EVERY_HOURS:
        return v
    raise ValueError("schedule must be off, daily@HH:MM[,HH:MM...] or every:N hours (N = " + ", ".join(map(str, EVERY_HOURS)) + ")")


def get_schedule() -> dict:
    doc = _collection().get(KEY) or {}
    return {**DEFAULT, **{k: doc[k] for k in ("schedule", "trading_days", "universe", "updated_at", "updated_by") if k in doc}}


def save_schedule(schedule: str, trading_days: bool, user: dict | None, universe: str | None = None) -> dict:
    from .universes import normalize_universe  # noqa: PLC0415

    doc = {"_key": KEY, "schedule": validate_schedule(schedule), "trading_days": bool(trading_days),
           "universe": normalize_universe(universe or DEFAULT["universe"]),
           "updated_at": datetime.now(timezone.utc).isoformat(),
           "updated_by": (user or {}).get("name") or (user or {}).get("username")}
    _collection().insert(doc, overwrite=True)
    return get_schedule()


def import_options() -> dict:
    """The Settings page's Data Defaults (saved overrides on the built-in ones),
    except the companies list, which is the schedule's own."""
    saved = ((_collection().get("app") or {}).get("values") or {}).get("data") or {}
    return {k: saved.get(k, v) for k, v in DATA_DEFAULTS.items() if k != "universe"}


# ------------------------------------------------------------------ timing

def _last_import(source: str | None = None) -> dict | None:
    flt = "FILTER r.source == @source" if source else ""
    rows = list(get_db().aql.execute(
        f"FOR r IN import_runs {flt} SORT r.created_at DESC LIMIT 1 RETURN r",
        bind_vars={"source": source} if source else {},
    ))
    return rows[0] if rows else None


def _last_start() -> datetime | None:
    last = _last_import()
    return datetime.fromisoformat(last["created_at"]) if last and last.get("created_at") else None


def _daily_slots(sched: dict, now: datetime) -> list[datetime]:
    """Every daily run time from yesterday to a week ahead (Ottawa), sorted,
    without the ones that would find no new close when trading_days is on."""
    times = [tuple(map(int, t.split(":"))) for t in sched["schedule"][6:].split(",")]
    today = now.astimezone(OTTAWA)
    slots = []
    for offset in range(-1, 9):
        day = today + timedelta(days=offset)
        for hh, mm in times:
            # Build in local wall time so 1:00 AM stays 1:00 AM across DST changes.
            at = datetime(day.year, day.month, day.day, hh, mm, tzinfo=OTTAWA)
            if not sched.get("trading_days") or _trading_day(at):
                slots.append(at)
    return sorted(slots)


def _trading_day(local: datetime) -> bool:
    """A run at this local time has a new close to fetch: the same day's close
    in the afternoon/evening, the previous day's before noon."""
    market_day = local if local.hour >= 12 else local - timedelta(days=1)
    return market_day.weekday() < 5


def next_run(sched: dict | None = None, now: datetime | None = None) -> datetime | None:
    """When the next automatic import is due (UTC), or None when off."""
    sched = sched or get_schedule()
    schedule = sched["schedule"]
    now = now or datetime.now(timezone.utc)
    if schedule.startswith("daily@"):
        # The first run time after the last import started (any import counts:
        # one that just ran covers the slot) and after the schedule was saved
        # (saving "daily at 01:00" at noon waits for tomorrow 01:00). A slot
        # missed while the backend was down runs once on start-up.
        marks = [t for t in (_last_start(), sched.get("updated_at") and datetime.fromisoformat(sched["updated_at"])) if t]
        last = max(marks) if marks else now
        upcoming = [at for at in _daily_slots(sched, now) if at.astimezone(timezone.utc) > last]
        return upcoming[0].astimezone(timezone.utc) if upcoming else None
    if schedule.startswith("every:"):
        last = _last_start()
        return (last + timedelta(hours=int(schedule[6:]))) if last else now
    return None


def _due(sched: dict, now: datetime) -> bool:
    nxt = next_run(sched, now)
    return nxt is not None and nxt <= now


def _import_running() -> str | None:
    """Why an import can't start now (one is running), or None."""
    from .activity import busy_by_others  # noqa: PLC0415 - activity imports a lot

    reason = busy_by_others("import", None)
    if reason:
        return reason
    # A workflow's import step (not in user_activity as an import).
    since = (datetime.now(timezone.utc) - timedelta(hours=12)).isoformat()
    running = list(get_db().aql.execute(
        "FOR r IN import_runs FILTER r.status == 'running' AND r.created_at >= @since LIMIT 1 RETURN r._key",
        bind_vars={"since": since},
    ))
    return "an import is already running" if running else None


# ------------------------------------------------------------------ starting

def start_import(source: str = "scheduled", user: dict | None = None, universe: str | None = None) -> dict:
    """Start an import of the schedule's companies with the Data Defaults.
    Returns {task_id, ticker_count, message}."""
    from ..extensions import notify_dashboard  # noqa: PLC0415
    from ..tasks.import_tasks import import_sp500_data  # noqa: PLC0415
    from .universes import normalize_universe, tickers_to_import, universe_tickers  # noqa: PLC0415
    from .yahoo_import import _last_closed_session_date  # noqa: PLC0415

    busy = _import_running()
    if busy:
        return {"task_id": None, "busy": True, "message": busy}
    opts = import_options()
    universe = normalize_universe(universe or get_schedule()["universe"])
    requested_list = universe_tickers(universe)
    tickers, existing = tickers_to_import(requested_list, opts["existing"], bool(opts["import_history"]))
    if not tickers:
        last = _last_closed_session_date()
        return {"task_id": None, "ticker_count": 0,
                "message": f"All {len(requested_list):,} companies are up to date through {last:%b} {last.day}, {last.year}."}
    task = import_sp500_data.delay(
        tickers=tickers, years=int(opts["years"]), interval="1d",
        import_history=bool(opts["import_history"]), import_statistics=bool(opts["import_statistics"]),
        import_calculated_stats=bool(opts["import_calculated_stats"]), import_earnings=bool(opts["import_earnings"]),
        scope="all", source=source, universe=universe,
        skipped=max(len(requested_list) - len(tickers), 0), existing=existing,
    )
    who = user or SCHEDULER_USER
    # Dashboard feed + bottom bar + the one-import-at-a-time lock see it like any user's import.
    get_db().collection("user_activity").insert({
        "created_at": datetime.now(timezone.utc).isoformat(),
        "user_id": who.get("id"), "username": who.get("username"), "name": who.get("name"),
        "kind": "import",
        "action": "Started the automatic import" if source == "scheduled" else "Started a data import",
        "details": f"{len(tickers):,} companies", "job": {"type": "import", "id": task.id},
    })
    try:
        notify_dashboard(force=True)
    except Exception:  # noqa: BLE001
        pass
    return {"task_id": task.id, "ticker_count": len(tickers), "message": f"Importing {len(tickers):,} companies"}


# ------------------------------------------------------------------ status

def status() -> dict:
    sched = get_schedule()
    nxt = next_run(sched)
    last_auto = _last_import("scheduled")
    last_any = _last_import()
    keep = ("_key", "created_at", "finished_at", "status", "total", "succeeded", "failed", "records", "error", "source")
    return {
        **sched,
        "next": nxt.isoformat() if nxt else None,
        "timezone": "America/Toronto",
        "options": import_options(),
        "last_auto": {k: last_auto.get(k) for k in keep} if last_auto else None,
        "last_import": {k: last_any.get(k) for k in keep} if last_any else None,
        "running": _import_running(),
        "scheduler": {"alive": _alive(), "message": state["last_message"]},
    }


def _alive() -> bool:
    """A backend process ran the loop in the last 2 minutes (any process: Redis heartbeat)."""
    try:
        beat = _redis.get("import_scheduler:beat")
        return bool(beat) and time.time() - float(beat) < 120
    except redis.RedisError:
        return state["alive"]


# ------------------------------------------------------------------ the loop

def _tick():
    now = datetime.now(timezone.utc)
    sched = get_schedule()
    if sched["schedule"] == "off" or not _due(sched, now):
        return
    result = start_import("scheduled")
    if result.get("task_id"):
        state["last_message"] = f"{now.isoformat()}: {result['message']}"
        log.info("Automatic import started (%s): %s", sched["schedule"], result["message"])
    elif not result.get("busy"):
        # Nothing to fetch: record it so the slot counts as done.
        get_db().collection("import_runs").insert({
            "created_at": now.isoformat(), "finished_at": now.isoformat(), "status": "completed",
            "source": "scheduled", "scope": "all", "universe": sched["universe"],
            "total": 0, "succeeded": 0, "failed": 0, "records": 0, "skipped": None,
            "message": result.get("message"),
        })
        state["last_message"] = f"{now.isoformat()}: {result.get('message')}"


def _loop():
    while True:
        try:
            # Leader lock: only one backend process starts imports.
            leader = _redis.set(LOCK_KEY, "1", nx=True, ex=TICK_SECONDS * 3) or state["leader"] and _redis.expire(LOCK_KEY, TICK_SECONDS * 3)
            state.update(alive=True, beat=datetime.now(timezone.utc).isoformat(), leader=bool(leader))
            if leader:
                _redis.set("import_scheduler:beat", str(time.time()), ex=300)
                _tick()
        except Exception as exc:  # noqa: BLE001 - keep the loop alive
            state["last_message"] = f"Scheduler error: {exc}"
            log.exception("Import scheduler")
        time.sleep(TICK_SECONDS)


def start():
    global _started
    if not _started:
        _started = True
        threading.Thread(target=_loop, daemon=True, name="import-scheduler").start()
