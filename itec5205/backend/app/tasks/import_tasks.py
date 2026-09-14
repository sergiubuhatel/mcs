"""Background bulk-import job: pull history + stats + financial ratios for
every requested ticker from Yahoo Finance and upsert into ArangoDB.

Runs as a Celery task because importing the full S&P 500 (~500 tickers,
several Yahoo requests each) takes long enough to make a synchronous HTTP
request impractical, and Yahoo rate-limits aggressive concurrent pulls.

Stoppable via cooperative cancellation: the `--pool=solo` executor (needed
on Windows) runs tasks in the worker's own process/thread, so there's no
child process for `revoke(terminate=True)` to kill. Instead the task checks
a plain Redis stop flag (see `stop_flags.py`) between tickers and, if set,
returns normally (a "stopped" result, not a Celery-level failure) carrying
whatever tickers are left -- which is exactly what /import/resume needs.
"""

import time

from ..extensions import socketio
from ..services.yahoo_import import import_ticker
from .celery_app import celery_app
from .stop_flags import clear_stop, is_stop_requested


@celery_app.task(bind=True, name="import_sp500_data")
def import_sp500_data(self, tickers: list[str], years: int = 10, interval: str = "1d", pause_seconds: float = 0.3):
    total = len(tickers)
    succeeded = []
    failed = []
    room = self.request.id

    for index, ticker in enumerate(tickers, start=1):
        if is_stop_requested(room):
            clear_stop(room)
            remaining_tickers = tickers[index - 1 :]
            result = {
                "stopped": True,
                "total": total,
                "succeeded_count": len(succeeded),
                "failed_count": len(failed),
                "failed": failed,
                "remaining_tickers": remaining_tickers,
                "years": years,
                "interval": interval,
            }
            socketio.emit("import_progress", {"stage": "stopped", **result}, room=room)
            return result

        try:
            summary = import_ticker(ticker, years=years, interval=interval)
            succeeded.append(summary)
        except Exception as exc:  # noqa: BLE001 - keep going for the rest of the universe
            failed.append({"ticker": ticker, "error": str(exc)})

        progress = {"ticker": ticker, "completed": index, "total": total, "succeeded": len(succeeded), "failed": len(failed)}
        self.update_state(state="PROGRESS", meta=progress)
        socketio.emit("import_progress", progress, room=room)
        time.sleep(pause_seconds)  # be polite to Yahoo Finance

    result = {
        "stopped": False,
        "total": total,
        "succeeded_count": len(succeeded),
        "failed_count": len(failed),
        "failed": failed,
        "remaining_tickers": [],
        "years": years,
        "interval": interval,
    }
    socketio.emit("import_progress", {"stage": "done", **result}, room=room)
    return result
