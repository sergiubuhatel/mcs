"""Export / import / delete ALL app data (the bottom bar's buttons).

Export and import use ArangoDB's own tools: `arangodump` writes the whole
database (every collection's structure, indexes and documents, compressed)
into a folder, packed here into one .tar for download; `arangorestore`
recreates every collection from such a file exactly as it was dumped --
collections in the file replace the ones in the database. Both binaries are
copied into the backend image from the arangodb image (backend/Dockerfile).

Restores run in a background thread of the API process; progress is polled
from `restore_status()`.
"""

import os
import shutil
import subprocess
import tarfile
import tempfile
import threading
import uuid
from datetime import datetime, timezone

from .. import config
from ..db.arango_client import COLLECTIONS, get_db

DUMP_DIR = "arangodump"  # folder name inside the .tar
THREADS = "4"


def counts() -> dict[str, int]:
    db = get_db()
    return {name: db.collection(name).count() for name in COLLECTIONS if db.has_collection(name)}


def _connection() -> list[str]:
    endpoint = config.ARANGO_HOST.replace("https://", "ssl://").replace("http://", "tcp://")
    return [
        "--configuration", "none",  # no arangodump.conf / arangorestore.conf in this image
        "--server.endpoint", endpoint,
        "--server.username", config.ARANGO_USER,
        "--server.password", config.ARANGO_PASSWORD,
        "--server.database", config.ARANGO_DB,
    ]


def _run(command: list[str]):
    done = subprocess.run(command, capture_output=True, text=True)
    if done.returncode != 0:
        lines = (done.stderr or done.stdout).strip().splitlines()
        raise RuntimeError(f"{command[0]} failed: {' '.join(lines[-3:]) or f'exit code {done.returncode}'}")
    return done.stdout


def dump_to_tar() -> str:
    """Dump the whole database; returns the path of the .tar (caller deletes)."""
    work = tempfile.mkdtemp(prefix="arangodump-")
    try:
        folder = os.path.join(work, DUMP_DIR)
        _run(["arangodump", *_connection(), "--output-directory", folder, "--overwrite", "true",
              "--compress-output", "true", "--threads", THREADS, "--all-databases", "false"])
        fd, archive = tempfile.mkstemp(suffix=".tar")
        os.close(fd)
        with tarfile.open(archive, "w") as tar:  # dump files are already gzip-compressed
            tar.add(folder, arcname=DUMP_DIR)
        return archive
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _unpack(archive: str, into: str) -> str:
    """The dump folder inside an Export All .tar, or ValueError."""
    try:
        with tarfile.open(archive) as tar:
            tar.extractall(into, filter="data")
    except (tarfile.TarError, OSError) as exc:
        raise ValueError("Not a file from Export All (expected an ArangoDB dump .tar)") from exc
    folder = os.path.join(into, DUMP_DIR)
    if not os.path.isfile(os.path.join(folder, "dump.json")):
        raise ValueError("Not a file from Export All (no ArangoDB dump inside)")
    return folder


_restore = {}
_restore_lock = threading.Lock()


def restore_status() -> dict:
    with _restore_lock:
        return dict(_restore)


def _set(**patch):
    with _restore_lock:
        _restore.update(patch)


def start_restore(archive: str) -> str:
    """Unpack (checks the file) and restore in the background."""
    work = tempfile.mkdtemp(prefix="arangorestore-")
    try:
        folder = _unpack(archive, work)
    except ValueError:
        shutil.rmtree(work, ignore_errors=True)
        raise
    finally:
        os.remove(archive)
    with _restore_lock:
        if _restore.get("status") == "running":
            shutil.rmtree(work, ignore_errors=True)
            raise RuntimeError("An import is already running")
        job = uuid.uuid4().hex
        _restore.clear()
        _restore.update({"job": job, "status": "running", "started_at": datetime.now(timezone.utc).isoformat()})
    threading.Thread(target=_run_restore, args=(folder, work), daemon=True).start()
    return job


def _run_restore(folder: str, work: str):
    try:
        _run(["arangorestore", *_connection(), "--input-directory", folder, "--create-database", "true",
              "--create-collection", "true", "--import-data", "true", "--overwrite", "true", "--threads", THREADS])
        _set(status="done", counts=counts(), finished_at=datetime.now(timezone.utc).isoformat())
    except Exception as exc:  # noqa: BLE001 - reported to the page
        _set(status="failed", error=str(exc), finished_at=datetime.now(timezone.utc).isoformat())
    finally:
        shutil.rmtree(work, ignore_errors=True)


def delete_all() -> dict[str, int]:
    """Empty every app collection (the collections and indexes stay)."""
    db = get_db()
    removed = counts()
    for name in removed:
        db.collection(name).truncate()
    return removed
