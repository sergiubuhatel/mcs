"""Shared extension instances.

``socketio`` is created once here (not inside ``create_app``) so that Celery
tasks running in a separate worker process can import this same object and
call ``socketio.emit(...)`` — Flask-SocketIO forwards it to connected
browser clients over the shared Redis ``message_queue``, without the worker
needing to run a Socket.IO server itself.
"""

from flask_cors import CORS
from flask_socketio import SocketIO

from . import config

socketio = SocketIO(
    cors_allowed_origins=config.CORS_ORIGINS,
    message_queue=config.SOCKETIO_REDIS_URL,
    async_mode="threading",
)
cors = CORS()
