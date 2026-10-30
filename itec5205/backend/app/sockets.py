"""Socket.IO event handlers. The frontend joins a room named after a Celery
task id right after triggering a bulk import or an RL training run, then
receives that task's progress pushed live from the worker (see
``tasks/import_tasks.py`` / ``tasks/rl_tasks.py`` and
``services/rl_service.py``'s ``SocketIOProgressCallback``) instead of
polling the status endpoint.
"""

from flask_socketio import join_room, leave_room

from . import config
from .auth import verify_token
from .extensions import socketio


@socketio.on("connect")
def handle_connect(auth=None):
    """Only signed-in users: the client sends its Keycloak token as `auth`."""
    if not config.KEYCLOAK_ENABLED:
        return True
    token = (auth or {}).get("token") if isinstance(auth, dict) else None
    return bool(token) and verify_token(token) is not None


@socketio.on("join")
def handle_join(data):
    room = (data or {}).get("room")
    if room:
        join_room(room)


@socketio.on("leave")
def handle_leave(data):
    room = (data or {}).get("room")
    if room:
        leave_room(room)
