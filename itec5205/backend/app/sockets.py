"""Socket.IO event handlers. The frontend joins a room named after a Celery
task id right after triggering a bulk import or an RL training run, then
receives that task's progress pushed live from the worker (see
``tasks/import_tasks.py`` / ``tasks/rl_tasks.py`` and
``services/rl_service.py``'s ``SocketIOProgressCallback``) instead of
polling the status endpoint.
"""

from flask_socketio import join_room, leave_room

from .extensions import socketio


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
