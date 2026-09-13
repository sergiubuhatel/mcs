"""Dev/Docker entry point.

``create_app()`` calls ``socketio.init_app(app)``, which wraps
``app.wsgi_app`` with Socket.IO's engine.io middleware -- so `app` is a
regular WSGI callable that any WSGI server can serve, and Socket.IO's
long-polling transport (this app's ``async_mode="threading"`` doesn't
support true WebSocket upgrades without eventlet/gevent) works
transparently through it. We serve it with Waitress rather than the
Flask/Werkzeug dev server.

In Docker, nginx sits in front of this (see backend/nginx.conf) and
Waitress binds to localhost only; set WAITRESS_HOST/WAITRESS_PORT to
change that (defaults suit running this directly for local dev).
"""

import os

from waitress import serve

from app import create_app

app = create_app()

if __name__ == "__main__":
    host = os.environ.get("WAITRESS_HOST", "0.0.0.0")
    port = int(os.environ.get("WAITRESS_PORT", "5000"))
    serve(app, host=host, port=port, threads=8)
