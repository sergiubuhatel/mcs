"""Background bulk-import job: pull history + stats + financial ratios for
every requested ticker from Yahoo Finance and upsert into ArangoDB.

Runs as a Celery task because importing the full S&P 500 (~500 tickers,
several Yahoo requests each) takes long enough to make a synchronous HTTP
request impractical. Each ticker needs several sequential Yahoo Finance
round trips (info, history, financials, balance sheet), so that per-ticker
latency -- not a throttling sleep -- is the real bottleneck; a bounded
thread pool fetches several tickers concurrently (the calls are I/O-bound,
so threads help a lot here) while still keeping concurrency low enough to
stay polite to Yahoo Finance.

Stoppable via cooperative cancellation: the `--pool=solo` executor (needed
on Windows) runs tasks in the worker's own process/thread, so there's no
child process for `revoke(terminate=True)` to kill. Instead the task checks
a plain Redis stop flag (see `stop_flags.py`) after every completed ticker
and, once set, cancels every not-yet-started ticker and returns normally (a
"stopped" result, not a Celery-level failure) carrying whatever tickers
never got picked up -- which is exactly what /import/resume needs.
"""

import logging
import threading
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from datetime import datetime, timezone

from yfinance.exceptions import YFRateLimitError

from ..db.arango_client import get_db
from ..extensions import socketio
from ..services.yahoo_import import import_ticker
from .celery_app import celery_app
from .stop_flags import clear_stop, is_stop_requested

MAX_WORKERS = 6
# Yahoo answers bursts with HTTP 429 (and then 401 "Invalid Crumb", since the
# crumb fetch is rate-limited too). A whole-universe run used to fail every
# ticker after the first ~550; now a 429 pauses ALL threads and the ticker is
# retried. Pause doubles per consecutive hit, reset by any success.
RATE_LIMIT_RETRIES = 8
RATE_LIMIT_PAUSE = 30
RATE_LIMIT_MAX_PAUSE = 300

logger = logging.getLogger(__name__)


class _ImportStopped(Exception):
    """A ticker that was waiting out a rate-limit pause when Stop came in."""


def _is_rate_limited(exc: Exception) -> bool:
    if isinstance(exc, YFRateLimitError):
        return True
    text = str(exc)
    return "Too Many Requests" in text or "Invalid Crumb" in text or "429" in text


class _YahooThrottle:
    """Shared by the pool's threads: one 429 pauses every thread, since the
    limit is per client IP, not per ticker."""

    def __init__(self, stop: threading.Event):
        self._lock = threading.Lock()
        self._resume_at = 0.0
        self._strikes = 0
        self._stop = stop

    def wait(self):
        while True:
            if self._stop.is_set():
                raise _ImportStopped()
            delay = self._resume_at - time.monotonic()
            if delay <= 0:
                return
            self._stop.wait(min(delay, 1.0))

    def hit(self, ticker: str):
        with self._lock:
            now = time.monotonic()
            if now < self._resume_at:
                return  # another thread already paused everyone
            pause = min(RATE_LIMIT_PAUSE * 2 ** self._strikes, RATE_LIMIT_MAX_PAUSE)
            self._strikes += 1
            self._resume_at = now + pause
        logger.warning("Yahoo rate limit at %s -- pausing all import threads for %d s", ticker, pause)

    def ok(self):
        with self._lock:
            self._strikes = 0


def _import_with_retry(throttle: _YahooThrottle, ticker: str, **options) -> dict:
    for attempt in range(RATE_LIMIT_RETRIES + 1):
        throttle.wait()
        try:
            result = import_ticker(ticker, **options)
        except Exception as exc:  # noqa: BLE001
            if not _is_rate_limited(exc) or attempt == RATE_LIMIT_RETRIES:
                raise
            throttle.hit(ticker)
            continue
        throttle.ok()
        return result
# Tickers listed by name on a run record (more = "N companies" only).
MAX_LISTED_TICKERS = 25


def _record_start(task_id: str, tickers: list[str], scope: str, source: str, options: dict,
                  universe: str | None, skipped: int) -> datetime:
    started = datetime.now(timezone.utc)
    get_db().collection("import_runs").insert({
        "_key": task_id,
        "created_at": started.isoformat(),
        "status": "running",
        "source": source,  # "manual" | "resume" | "policy"
        "scope": scope,  # "all" | "specific"
        "universe": universe,  # "sp500" | "russell3000" when scope is "all"
        "skipped": skipped,  # requested tickers left out (already imported / up to date)
        "total": len(tickers),
        "tickers": tickers if len(tickers) <= MAX_LISTED_TICKERS else None,
        **options,
    }, overwrite=True)
    return started


def _record_end(task_id: str, started: datetime, **patch):
    ended = datetime.now(timezone.utc)
    get_db().collection("import_runs").update({
        "_key": task_id, "finished_at": ended.isoformat(),
        "wall_seconds": round((ended - started).total_seconds(), 1), **patch,
    })


@celery_app.task(bind=True, name="import_sp500_data")
def import_sp500_data(
    self,
    tickers: list[str],
    years: int = 10,
    interval: str = "1d",
    import_history: bool = True,
    import_statistics: bool = True,
    import_calculated_stats: bool = True,
    scope: str = "specific",
    source: str = "manual",
    universe: str | None = "sp500",
    skipped: int = 0,
):
    options = {"years": years, "import_history": import_history, "import_statistics": import_statistics,
               "import_calculated_stats": import_calculated_stats}
    started = _record_start(self.request.id, tickers, scope, source, options, universe if scope == "all" else None, skipped)
    try:
        result = _run_import(self, tickers, years, interval, import_history, import_statistics, import_calculated_stats)
    except Exception as exc:
        _record_end(self.request.id, started, status="failed", error=str(exc))
        raise
    failed = result["failed"]
    status = "stopped" if result["stopped"] else ("completed_with_failures" if failed else "completed")
    _record_end(
        self.request.id, started, status=status, succeeded=result["succeeded_count"], failed=len(failed),
        failed_tickers=[f["ticker"] for f in failed][:MAX_LISTED_TICKERS], remaining=len(result["remaining_tickers"]),
        records=result.pop("records"),
    )
    return result


def _run_import(self, tickers, years, interval, import_history, import_statistics, import_calculated_stats):
    total = len(tickers)
    succeeded = []
    failed = []
    remaining = []
    completed = 0
    room = self.request.id
    stopping = False
    stop_event = threading.Event()
    throttle = _YahooThrottle(stop_event)

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        future_to_ticker = {
            pool.submit(
                _import_with_retry, throttle, t, years=years, interval=interval,
                import_history=import_history, import_statistics=import_statistics,
                import_calculated_stats=import_calculated_stats,
            ): t
            for t in tickers
        }

        pending = set(future_to_ticker)
        while pending:
            # Timed wait instead of as_completed: during a rate-limit pause no
            # ticker finishes for minutes, and Stop must still be noticed.
            done, pending = wait(pending, timeout=1.0, return_when=FIRST_COMPLETED)
            for future in done:
                ticker = future_to_ticker[future]

                if future.cancelled():
                    remaining.append(ticker)
                    continue
                try:
                    succeeded.append(future.result())
                except _ImportStopped:
                    remaining.append(ticker)  # was paused when Stop came in -- resume picks it up
                    continue
                except Exception as exc:  # noqa: BLE001 - keep going for the rest of the universe
                    failed.append({"ticker": ticker, "error": str(exc)})
                completed += 1

                progress = {"ticker": ticker, "completed": completed, "total": total, "succeeded": len(succeeded), "failed": len(failed)}
                self.update_state(state="PROGRESS", meta=progress)
                socketio.emit("import_progress", progress, room=room)

            if not stopping and is_stop_requested(room):
                stopping = True
                clear_stop(room)
                stop_event.set()
                for other_future in pending:
                    other_future.cancel()  # not yet started -- surfaces as .cancelled() above, added to `remaining`

    records = sum((s.get("history_rows") or 0) for s in succeeded)  # price rows written
    if stopping:
        result = {
            "records": records,
            "stopped": True,
            "total": total,
            "succeeded_count": len(succeeded),
            "failed_count": len(failed),
            "failed": failed,
            "remaining_tickers": remaining,
            "years": years,
            "interval": interval,
            "import_history": import_history,
            "import_statistics": import_statistics,
            "import_calculated_stats": import_calculated_stats,
        }
        socketio.emit("import_progress", {"stage": "stopped", **{k: v for k, v in result.items() if k != "records"}}, room=room)
        return result

    result = {
        "records": records,
        "stopped": False,
        "total": total,
        "succeeded_count": len(succeeded),
        "failed_count": len(failed),
        "failed": failed,
        "remaining_tickers": [],
        "years": years,
        "interval": interval,
        "import_history": import_history,
        "import_statistics": import_statistics,
        "import_calculated_stats": import_calculated_stats,
    }
    socketio.emit("import_progress", {"stage": "done", **{k: v for k, v in result.items() if k != "records"}}, room=room)
    return result
