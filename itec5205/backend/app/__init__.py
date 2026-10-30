from flask import Flask, jsonify, request

from . import config
from .auth import current_user
from .extensions import cors, socketio

# Reachable without a token: the health probe, and the tab-closing beacon,
# which can't send headers and verifies the token in its body itself.
PUBLIC_PATHS = {"/api/health", "/api/activity/leave"}


def create_app() -> Flask:
    app = Flask(__name__)

    cors.init_app(app, resources={r"/api/*": {"origins": "*"}})
    socketio.init_app(app)

    from .api import activity, arima, backup, companies, forecasts, signals, data, orders, workflows, pools, portfolios, predictions, rl, settings

    app.register_blueprint(companies.bp)
    app.register_blueprint(pools.bp)
    app.register_blueprint(portfolios.bp)
    app.register_blueprint(rl.bp)
    app.register_blueprint(data.bp)
    app.register_blueprint(predictions.bp)
    app.register_blueprint(arima.bp)
    app.register_blueprint(forecasts.bp)
    app.register_blueprint(signals.bp)
    app.register_blueprint(workflows.bp)
    app.register_blueprint(settings.bp)
    app.register_blueprint(orders.bp)
    app.register_blueprint(backup.bp)
    app.register_blueprint(activity.bp)

    # Every API call needs a valid Keycloak access token (Authorization: Bearer).
    @app.before_request
    def require_sign_in():
        if (not config.KEYCLOAK_ENABLED or request.method == "OPTIONS"
                or not request.path.startswith("/api/") or request.path in PUBLIC_PATHS):
            return None
        if current_user() is None:
            return jsonify({"error": "Sign in first"}), 401
        return None

    # Dashboard: log every change a signed-in user makes (services/activity.py).
    from .services.activity import record_request

    app.after_request(record_request)

    from . import sockets  # noqa: F401 - registers Socket.IO event handlers

    @app.get("/api/health")
    def health():
        return jsonify({"status": "ok"})

    return app
