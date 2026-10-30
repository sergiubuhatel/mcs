"""Import All / Export All / Delete All Data (services/backup.py)."""

import os
import tempfile
from datetime import date

from celery.result import AsyncResult
from flask import Blueprint, Response, jsonify, request

from ..auth import require_admin
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
@require_admin
def export_all():
    """The whole database as an arangodump .tar (dumped first, then sent)."""
    try:
        archive = backup.dump_to_tar()
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 500

    def stream():
        try:
            with open(archive, "rb") as fh:
                while chunk := fh.read(1 << 20):
                    yield chunk
        finally:
            os.remove(archive)

    filename = f"itec5205-arangodb-{date.today().isoformat()}.tar"
    return Response(stream(), mimetype="application/x-tar", headers={
        "Content-Disposition": f'attachment; filename="{filename}"',
        "Content-Length": str(os.path.getsize(archive)),
    })


@bp.post("/import")
@require_admin
def import_all():
    """Multipart `file` = an Export All .tar; restored in the background."""
    upload = request.files.get("file")
    if not upload:
        return jsonify({"error": "Choose a file made with Export All"}), 400
    fd, archive = tempfile.mkstemp(suffix=".tar")
    os.close(fd)
    upload.save(archive)
    try:
        job = backup.start_restore(archive)
    except (ValueError, RuntimeError) as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify({"job": job}), 202


@bp.get("/import/status")
def import_status():
    return jsonify(backup.restore_status())


def _busy() -> str | None:
    """Why deleting now would be unsafe (a job still writing), or None."""
    if backup.restore_status().get("status") == "running":
        return "An import is running"
    # Only a task Celery reports as working counts: a run left "running" by a
    # worker restart reads PENDING and must not block this forever.
    for key in get_db().aql.execute("FOR r IN import_runs FILTER r.status == 'running' RETURN r._key"):
        if AsyncResult(key, app=celery_app).state in ("STARTED", "PROGRESS", "RETRY"):
            return "A market data import is running; stop it first"
    return None


@bp.delete("/all")
@require_admin
def delete_all():
    """Body `{"confirm": "DELETE"}` -- empties every collection."""
    if (request.get_json(silent=True) or {}).get("confirm") != "DELETE":
        return jsonify({"error": "Type DELETE to confirm"}), 400
    reason = _busy()
    if reason:
        return jsonify({"error": reason}), 409
    removed = backup.delete_all()
    return jsonify({"removed": removed, "total": sum(removed.values())})
