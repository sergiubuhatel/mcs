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

from concurrent.futures import ThreadPoolExecutor, as_completed

from ..extensions import socketio
from ..services.yahoo_import import import_ticker
from .celery_app import celery_app
from .stop_flags import clear_stop, is_stop_requested

MAX_WORKERS = 6


@celery_app.task(bind=True, name="import_sp500_data")
def import_sp500_data(
    self,
    tickers: list[str],
    years: int = 10,
    interval: str = "1d",
    import_history: bool = True,
    import_statistics: bool = True,
    import_calculated_stats: bool = True,
):
    total = len(tickers)
    succeeded = []
    failed = []
    remaining = []
    completed = 0
    room = self.request.id
    stopping = False

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        future_to_ticker = {
            pool.submit(
                import_ticker, t, years=years, interval=interval,
                import_history=import_history, import_statistics=import_statistics,
                import_calculated_stats=import_calculated_stats,
            ): t
            for t in tickers
        }

        for future in as_completed(future_to_ticker):
            ticker = future_to_ticker[future]

            if future.cancelled():
                remaining.append(ticker)
                continue

            completed += 1
            try:
                succeeded.append(future.result())
            except Exception as exc:  # noqa: BLE001 - keep going for the rest of the universe
                failed.append({"ticker": ticker, "error": str(exc)})

            progress = {"ticker": ticker, "completed": completed, "total": total, "succeeded": len(succeeded), "failed": len(failed)}
            self.update_state(state="PROGRESS", meta=progress)
            socketio.emit("import_progress", progress, room=room)

            if not stopping and is_stop_requested(room):
                stopping = True
                clear_stop(room)
                for other_future, other_ticker in future_to_ticker.items():
                    if other_future.cancel():
                        pass  # not yet started -- surfaces as .cancelled() above, added to `remaining`

    if stopping:
        result = {
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
        socketio.emit("import_progress", {"stage": "stopped", **result}, room=room)
        return result

    result = {
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
    socketio.emit("import_progress", {"stage": "done", **result}, room=room)
    return result
