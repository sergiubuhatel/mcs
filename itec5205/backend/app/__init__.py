from flask import Flask, jsonify

from .extensions import cors, socketio


def create_app() -> Flask:
    app = Flask(__name__)

    cors.init_app(app, resources={r"/api/*": {"origins": "*"}})
    socketio.init_app(app)

    from .api import arima, backup, companies, forecasts, signals, data, orders, workflows, pools, portfolios, predictions, rl, settings

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

    from . import sockets  # noqa: F401 - registers Socket.IO event handlers

    @app.get("/api/health")
    def health():
        return jsonify({"status": "ok"})

    return app
