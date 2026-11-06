"""App-wide initial values edited on the Settings page.

The frontend owns the built-in defaults (and which keys exist); this stores
only what the user saved, as one document, so every browser opens the pages
with the same starting values.
"""

import json
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

from ..auth import require_admin
from ..db.arango_client import get_db

bp = Blueprint("settings", __name__, url_prefix="/api/settings")

COLLECTION = "settings"
KEY = "app"
MAX_BYTES = 64 * 1024


def _collection():
    db = get_db()
    if not db.has_collection(COLLECTION):
        db.create_collection(COLLECTION)
    return db.collection(COLLECTION)


@bp.get("")
def get_settings():
    doc = _collection().get(KEY)
    return jsonify({"settings": (doc or {}).get("values", {}), "updated_at": (doc or {}).get("updated_at")})


@bp.put("")
def save_settings():
    body = request.get_json(silent=True) or {}
    values = body.get("settings")
    # Sections of plain values, e.g. {"forecast": {"training_days": 2515}}.
    if not isinstance(values, dict) or not all(isinstance(v, dict) for v in values.values()):
        return jsonify({"error": "settings must be an object of sections"}), 400
    if len(json.dumps(values)) > MAX_BYTES:
        return jsonify({"error": "settings are too large"}), 400
    doc = {"_key": KEY, "values": values, "updated_at": datetime.now(timezone.utc).isoformat()}
    _collection().insert(doc, overwrite=True)
    return jsonify({"settings": values, "updated_at": doc["updated_at"]})


@bp.delete("")
def reset_settings():
    collection = _collection()
    if collection.has(KEY):
        collection.delete(KEY)
    return jsonify({"settings": {}, "updated_at": None})


# ------------------------------------------------------------ automatic import
# Schedule + status of the automatic import (services/import_schedule.py).

@bp.get("/import-schedule")
def get_import_schedule():
    from ..services import import_schedule  # noqa: PLC0415

    return jsonify(import_schedule.status())


@bp.put("/import-schedule")
@require_admin
def save_import_schedule():
    from ..auth import current_user  # noqa: PLC0415
    from ..services import import_schedule  # noqa: PLC0415

    body = request.get_json(silent=True) or {}
    try:
        import_schedule.save_schedule(body.get("schedule"), body.get("trading_days", True), current_user(), body.get("universe"))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify(import_schedule.status())


@bp.post("/import-schedule/run")
@require_admin
def run_import_now():
    """Start an import with the Data Defaults now (what the schedule runs)."""
    from ..auth import current_user  # noqa: PLC0415
    from ..services import import_schedule  # noqa: PLC0415

    user = current_user() or {}
    result = import_schedule.start_import("manual", {"id": user.get("id"), "username": user.get("username"), "name": user.get("name")})
    if result.get("busy"):
        return jsonify({"error": result["message"], "busy": True}), 409
    return jsonify(result), 202 if result.get("task_id") else 200
