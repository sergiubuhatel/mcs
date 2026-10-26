"""Import All / Export All / Delete All Data (services/backup.py)."""

import os
import tempfile
from datetime import date

from celery.result import AsyncResult
from flask import Blueprint, Response, jsonify, request

from ..db.arango_client import get_db
from ..services import backup
from ..tasks.celery_app import celery_app

bp = Blueprint("backup", __name__, url_prefix="/api/backup")


@bp.get("/summary")
def summary():
    """Documents per collection (what Export All / Delete All cover)."""
    counts = backup.counts()
    return jsonify({"counts": counts, "total": sum(counts.values())})


@bp.get("/export")
def export_all():
    filename = f"itec5205-data-{date.today().isoformat()}.jsonl.gz"
    return Response(
        backup.export_stream(),
        mimetype="application/gzip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"', "X-Accel-Buffering": "no"},
    )


@bp.post("/import")
def import_all():
    """Multipart `file` = an Export All file; restored in the background."""
    upload = request.files.get("file")
    if not upload:
        return jsonify({"error": "Choose an export file"}), 400
    fd, path = tempfile.mkstemp(suffix=".jsonl.gz")
    os.close(fd)
    upload.save(path)
    try:
        header = backup.read_header(path)
        job = backup.start_restore(path, header)
    except (ValueError, RuntimeError) as exc:
        os.remove(path)
        return jsonify({"error": str(exc)}), 400
    return jsonify({"job": job, "header": header}), 202


@bp.get("/import/status")
def import_status():
    return jsonify(backup.restore_status())


def _busy() -> str | None:
    """Why deleting now would be unsafe (a job still writing), or None."""
    if backup.restore_status().get("status") == "running":
        return "An import of all data is running"
    # Only a task Celery reports as working counts: a run left "running" by a
    # worker restart reads PENDING and must not block this forever.
    for key in get_db().aql.execute("FOR r IN import_runs FILTER r.status == 'running' RETURN r._key"):
        if AsyncResult(key, app=celery_app).state in ("STARTED", "PROGRESS", "RETRY"):
            return "A market data import is running; stop it first"
    return None


@bp.delete("/all")
def delete_all():
    """Body `{"confirm": "DELETE"}` -- empties every collection."""
    if (request.get_json(silent=True) or {}).get("confirm") != "DELETE":
        return jsonify({"error": 'Type DELETE to confirm'}), 400
    reason = _busy()
    if reason:
        return jsonify({"error": reason}), 409
    removed = backup.delete_all()
    return jsonify({"removed": removed, "total": sum(removed.values())})
