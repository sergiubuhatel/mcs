"""Shared extension instances.

``socketio`` is created once here (not inside ``create_app``) so that Celery
tasks running in a separate worker process can import this same object and
call ``socketio.emit(...)`` — Flask-SocketIO forwards it to connected
browser clients over the shared Redis ``message_queue``, without the worker
needing to run a Socket.IO server itself.
"""

import time

from flask_cors import CORS
from flask_socketio import SocketIO

from . import config

# The Dashboard page joins this room and refetches when told something changed.
DASHBOARD_ROOM = "dashboard"
DASHBOARD_EVENT = "dashboard_changed"
_DASHBOARD_MIN_GAP = 2.0  # seconds; progress events can come several per second
_FINAL_STAGES = {"done", "stopped", "failed", "error"}


class _SocketIO(SocketIO):
    """Every job's progress event (import, LSTM, ARIMA, RL...) also pings the
    Dashboard, so it shows running jobs live without each task knowing it."""

    def emit(self, event, *args, **kwargs):
        super().emit(event, *args, **kwargs)
        if event != DASHBOARD_EVENT:
            payload = args[0] if args and isinstance(args[0], dict) else {}
            notify_dashboard(force=payload.get("stage") in _FINAL_STAGES)


socketio = _SocketIO(
    cors_allowed_origins=config.CORS_ORIGINS,
    message_queue=config.SOCKETIO_REDIS_URL,
    async_mode="threading",
)
cors = CORS()

_last_notify = 0.0


def notify_dashboard(force: bool = False) -> None:
    """Tell open Dashboards to refresh (at most every 2 s unless `force`)."""
    global _last_notify
    now = time.monotonic()
    if not force and now - _last_notify < _DASHBOARD_MIN_GAP:
        return
    _last_notify = now
    try:
        SocketIO.emit(socketio, DASHBOARD_EVENT, {}, to=DASHBOARD_ROOM)
    except Exception:  # Redis down etc.: the Dashboard's fallback poll catches up
        pass
