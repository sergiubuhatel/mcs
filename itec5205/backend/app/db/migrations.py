"""Automatic schema upgrade + data backfill, run every time the backend starts.

Production keeps its data across deploys, so every step here is ADDITIVE:
it creates what is missing, renames/moves old shapes, and fills new fields
for documents that already exist -- it never drops a collection or deletes
user data.

Two kinds of steps:

* schema (fast, every start, before the API serves): create missing
  collections + indexes (`COLLECTIONS` in arango_client.py) and run the
  one-time renames. Safe to repeat.
* data (versioned, once each, in a background thread so the API is up
  immediately): backfills and seeds. Each finished step is recorded in the
  `schema_migrations` collection (`_key` = step id) and never runs again; a
  failed step is retried on the next start.

Add a new step by appending to DATA_STEPS -- never renumber or remove one.
Run by `upgrade()` from wsgi.py (backend) and scripts/init_db.py (the
compose one-shot that runs before the workers).
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone

import redis

from .. import config
from .arango_client import COLLECTIONS, _migrate_policy_names, get_db

log = logging.getLogger(__name__)

MIGRATIONS = "schema_migrations"
LOCK_KEY = "schema_migrations:lock"
LOCK_SECONDS = 30 * 60


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ------------------------------------------------------------------ schema

def upgrade_schema(db=None):
    """Create missing collections + indexes and apply renames. Idempotent."""
    db = db or get_db()
    _migrate_policy_names(db)
    for name, indexes in {**COLLECTIONS, MIGRATIONS: []}.items():
        if not db.has_collection(name):
            db.create_collection(name)
            log.info("Schema: created collection %s", name)
        collection = db.collection(name)
        for index in indexes:
            collection.add_index(index)  # no-op when it already exists
    return db


# ------------------------------------------------------------------ data steps

def _backfill_calculated_stats(db):
    """calculated_stats rows from before the Trend Quality metrics (2026-10-16):
    fill ONLY those companies; rows that already have them are left as they are."""
    tickers = list(db.aql.execute(
        "FOR c IN calculated_stats FILTER c.trend_return_1y == null AND c.stock_growth_1y != null RETURN c._key"
    ))
    if not tickers:
        return "already complete"
    from ..services.yahoo_import import store_calculated_stats  # noqa: PLC0415

    done = sum(store_calculated_stats(tickers[i:i + 50]) for i in range(0, len(tickers), 50))
    return f"{done:,} of {len(tickers):,} companies filled from stored prices"


def _import_runs_source(db):
    """Old import runs without a source were started from the Market Data page."""
    db.aql.execute("FOR r IN import_runs FILTER r.source == null UPDATE r WITH {source: 'manual'} IN import_runs")
    return "done"


def _seed_import_schedule(db):
    """Automatic import default: the Russell 3000 every day at 4:00 AM, 4:30 PM and 6:00 PM (Ottawa).
    A schedule someone already saved is left as it is."""
    from ..services.import_schedule import DEFAULT  # noqa: PLC0415

    col = db.collection("settings")
    if col.has("import_schedule"):
        return "kept the saved schedule"
    col.insert({"_key": "import_schedule", **DEFAULT, "updated_at": _now(), "updated_by": "upgrade"})
    return f"seeded ({DEFAULT['schedule']}, {DEFAULT['universe']})"


def _initial_import(db):
    """Empty database (fresh install): fetch the companies once with the Data Defaults."""
    if db.collection("companies").count() > 0:
        return "database already has companies"
    if not config.AUTO_INITIAL_IMPORT:
        return "skipped (AUTO_INITIAL_IMPORT=false)"
    from ..services.import_schedule import STARTUP_GRACE_SECONDS, start_import  # noqa: PLC0415

    # Wait until a deploy has finished restarting the workers (see import_schedule).
    time.sleep(STARTUP_GRACE_SECONDS)
    result = start_import("initial")
    if result.get("busy"):
        raise RuntimeError("an import is already running; retry on the next start")
    return result.get("message", "")


def _default_import_times_2(db):
    """Default times changed to 4:00 AM, 4:30 PM and 6:00 PM. Only a schedule
    the upgrade itself seeded with the old default is moved; one saved on the
    Settings page is left as it is."""
    from ..services.import_schedule import DEFAULT  # noqa: PLC0415

    col = db.collection("settings")
    doc = col.get("import_schedule")
    if not doc:
        return "no schedule yet (seeded with the new default)"
    if doc.get("updated_by") != "upgrade" or doc.get("schedule") != "daily@01:00,17:00,18:00":
        return f"kept the saved schedule ({doc.get('schedule')})"
    col.update({"_key": "import_schedule", "schedule": DEFAULT["schedule"], "updated_at": _now()})
    return f"moved to {DEFAULT['schedule']}"


# (id, description, function). Append only.
DATA_STEPS = [
    ("2026-11-06-calculated-stats-trend", "Trend Quality metrics for every company", _backfill_calculated_stats),
    ("2026-11-06-import-runs-source", "Source on old import runs", _import_runs_source),
    ("2026-11-06-import-schedule", "Automatic import schedule", _seed_import_schedule),
    ("2026-11-06-initial-import", "First import on an empty database", _initial_import),
    ("2026-11-07-default-import-times", "Default import times 04:00, 16:30, 18:00", _default_import_times_2),
]


def upgrade_data(db=None):
    db = db or get_db()
    done = db.collection(MIGRATIONS)
    for step_id, description, fn in DATA_STEPS:
        if done.has(step_id):
            continue
        started = time.monotonic()
        try:
            outcome = fn(db)
        except Exception as exc:  # noqa: BLE001 - retried on the next start
            log.exception("Upgrade step %s failed", step_id)
            done.insert({"_key": f"failed-{step_id}-{int(time.time())}", "step": step_id, "failed_at": _now(),
                         "error": str(exc)[:500]})
            continue
        done.insert({"_key": step_id, "description": description, "applied_at": _now(),
                     "seconds": round(time.monotonic() - started, 1), "outcome": str(outcome)[:500]})
        log.info("Upgrade step %s: %s", step_id, outcome)


# ------------------------------------------------------------------ entry point

def _lock():
    try:
        client = redis.from_url(config.REDIS_URL)
        return client if client.set(LOCK_KEY, "1", nx=True, ex=LOCK_SECONDS) else False
    except redis.RedisError:
        return None  # no Redis: run anyway (steps are idempotent / recorded)


def _with_lock(fn):
    client = _lock()
    if client is False:
        log.info("Another process is upgrading the database; skipping")
        return
    try:
        fn()
    finally:
        if client:
            client.delete(LOCK_KEY)


def wait_for_db(attempts: int = 60, delay: float = 2.0):
    for attempt in range(1, attempts + 1):
        try:
            get_db().version()
            return
        except Exception as exc:  # noqa: BLE001 - connection refused / 503 while ArangoDB boots
            if attempt == attempts:
                raise
            log.info("ArangoDB not ready (%s), retry %d/%d", exc.__class__.__name__, attempt, attempts)
            get_db.cache_clear()
            time.sleep(delay)


def upgrade(data: bool = True, background: bool = True):
    """Schema now; data steps in a background thread (or inline)."""
    wait_for_db()
    upgrade_schema()
    if not data:
        return
    if background:
        threading.Thread(target=_with_lock, args=(upgrade_data,), daemon=True, name="db-upgrade").start()
    else:
        _with_lock(upgrade_data)
