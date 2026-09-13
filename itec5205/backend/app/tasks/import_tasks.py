"""Background bulk-import job: pull history + stats + financial ratios for
every requested ticker from Yahoo Finance and upsert into ArangoDB.

Runs as a Celery task because importing the full S&P 500 (~500 tickers,
several Yahoo requests each) takes long enough to make a synchronous HTTP
request impractical, and Yahoo rate-limits aggressive concurrent pulls.
"""

import time

from ..extensions import socketio
from ..services.yahoo_import import import_ticker
from .celery_app import celery_app


@celery_app.task(bind=True, name="import_sp500_data")
def import_sp500_data(self, tickers: list[str], period: str = "2y", interval: str = "1d", pause_seconds: float = 0.3):
    total = len(tickers)
    succeeded = []
    failed = []
    room = self.request.id

    for index, ticker in enumerate(tickers, start=1):
        try:
            summary = import_ticker(ticker, period=period, interval=interval)
            succeeded.append(summary)
        except Exception as exc:  # noqa: BLE001 - keep going for the rest of the universe
            failed.append({"ticker": ticker, "error": str(exc)})

        progress = {"ticker": ticker, "completed": index, "total": total, "succeeded": len(succeeded), "failed": len(failed)}
        self.update_state(state="PROGRESS", meta=progress)
        socketio.emit("import_progress", progress, room=room)
        time.sleep(pause_seconds)  # be polite to Yahoo Finance

    result = {
        "total": total,
        "succeeded_count": len(succeeded),
        "failed_count": len(failed),
        "failed": failed,
    }
    socketio.emit("import_progress", {"stage": "done", **result}, room=room)
    return result
