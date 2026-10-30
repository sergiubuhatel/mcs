"""Signed-in users and what they do (Dashboard page)."""

import json

from flask import Blueprint, jsonify, request

from ..auth import current_user, verify_token
from ..services import activity

bp = Blueprint("activity", __name__, url_prefix="/api/activity")


@bp.post("/heartbeat")
def heartbeat():
    """Body `{page}`: the browser is open on that page (every 30 s + on navigation)."""
    user = current_user()
    if user is None:
        return jsonify({"error": "Sign in first"}), 401
    activity.heartbeat(user, (request.get_json(silent=True) or {}).get("page"))
    return jsonify({"ok": True})


@bp.post("/logout")
def logout():
    user = current_user()
    if user is not None:
        activity.logout(user)
    return jsonify({"ok": True})


@bp.post("/leave")
def leave():
    """The tab is closing (navigator.sendBeacon, which can't send headers):
    the token comes in the body."""
    try:
        token = json.loads(request.get_data(as_text=True) or "{}").get("token")
    except ValueError:
        token = None
    user = verify_token(token) if token else None
    if user is not None:
        activity.leave(user)
    return jsonify({"ok": True})


@bp.get("/dashboard")
def dashboard():
    return jsonify(activity.dashboard(min(int(request.args.get("limit", 100)), 500)))


@bp.get("/overview")
def overview():
    return jsonify(activity.overview())
