from flask import Flask, jsonify

from .extensions import cors, socketio


def create_app() -> Flask:
    app = Flask(__name__)

    cors.init_app(app, resources={r"/api/*": {"origins": "*"}})
    socketio.init_app(app)

    from .api import companies, data, pools, portfolios, predictions, rl

    app.register_blueprint(companies.bp)
    app.register_blueprint(pools.bp)
    app.register_blueprint(portfolios.bp)
    app.register_blueprint(rl.bp)
    app.register_blueprint(data.bp)
    app.register_blueprint(predictions.bp)

    from . import sockets  # noqa: F401 - registers Socket.IO event handlers

    @app.get("/api/health")
    def health():
        return jsonify({"status": "ok"})

    return app
