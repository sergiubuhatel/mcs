"""Export / import / delete ALL app data (the bottom bar's buttons).

Export format: gzip-compressed JSON Lines, so a multi-million-row database
streams out and back in without holding it in memory. Line 1 is a header
`{"format": "itec5205-data", "version": 1, "exported_at", "counts"}`; every
other line is one document: `{"c": <collection>, "d": <document>}` (without
ArangoDB's `_id`/`_rev`; `_key` kept, so links between documents survive).

Import upserts every document (same `_key` = replaced), so on a new
installation it reproduces the exported database; to restore an exact copy
over existing data, delete all data first. It runs in a background thread of
the API process; progress is polled from `restore_status()`.
"""

import gzip
import json
import os
import threading
import uuid
import zlib
from datetime import datetime, timezone

from ..db.arango_client import COLLECTIONS, ensure_collections, get_db

FORMAT = "itec5205-data"
VERSION = 1
BATCH = 5000
_CHUNK = 1 << 20  # compress ~1 MB of text at a time


def app_collections() -> list[str]:
    return list(COLLECTIONS)


def counts() -> dict[str, int]:
    db = get_db()
    return {name: db.collection(name).count() for name in app_collections() if db.has_collection(name)}


def export_stream():
    """Yields the gzip-compressed export, chunk by chunk."""
    db = get_db()
    compressor = zlib.compressobj(6, zlib.DEFLATED, 31)  # wbits 31 = gzip container
    header = {"format": FORMAT, "version": VERSION,
              "exported_at": datetime.now(timezone.utc).isoformat(), "counts": counts()}
    buffer = [json.dumps(header) + "\n"]
    size = 0
    for name in header["counts"]:
        cursor = db.aql.execute(
            "FOR d IN @@c RETURN UNSET(d, '_id', '_rev')",
            bind_vars={"@c": name}, batch_size=BATCH, stream=True, ttl=3600,
        )
        for doc in cursor:
            line = json.dumps({"c": name, "d": doc}, separators=(",", ":")) + "\n"
            buffer.append(line)
            size += len(line)
            if size >= _CHUNK:
                yield compressor.compress("".join(buffer).encode())
                buffer, size = [], 0
    yield compressor.compress("".join(buffer).encode())
    yield compressor.flush()


# One restore at a time; its progress lives in this process.
_restore = {}
_restore_lock = threading.Lock()


def restore_status() -> dict:
    with _restore_lock:
        return dict(_restore)


def _set(**patch):
    with _restore_lock:
        _restore.update(patch)


def _open(path):
    with open(path, "rb") as fh:
        gzipped = fh.read(2) == b"\x1f\x8b"
    return gzip.open(path, "rt", encoding="utf-8") if gzipped else open(path, "r", encoding="utf-8")


def read_header(path) -> dict:
    """The file's header line, or ValueError when it isn't an export."""
    try:
        with _open(path) as fh:
            header = json.loads(fh.readline())
    except (OSError, ValueError, UnicodeDecodeError) as exc:
        raise ValueError("Not an export file from this app (expected a .jsonl.gz from Export All)") from exc
    if header.get("format") != FORMAT:
        raise ValueError("Not an export file from this app (expected a .jsonl.gz from Export All)")
    if header.get("version", 0) > VERSION:
        raise ValueError(f"The file is from a newer version of the app (format {header['version']})")
    return header


def start_restore(path: str, header: dict) -> str:
    with _restore_lock:
        if _restore.get("status") == "running":
            raise RuntimeError("An import of all data is already running")
        job = uuid.uuid4().hex
        _restore.clear()
        _restore.update({
            "job": job, "status": "running", "total": sum(header.get("counts", {}).values()),
            "done": 0, "collection": None, "skipped": {}, "exported_at": header.get("exported_at"),
            "started_at": datetime.now(timezone.utc).isoformat(),
        })
    threading.Thread(target=_run_restore, args=(path,), daemon=True).start()
    return job


def _run_restore(path: str):
    db = ensure_collections()
    known = set(app_collections())
    skipped: dict[str, int] = {}
    pending: dict[str, list] = {}
    done = 0

    def flush(name):
        nonlocal done
        docs = pending.pop(name, [])
        if docs:
            db.collection(name).insert_many(docs, overwrite=True, raise_on_document_error=True)
            done += len(docs)
            _set(done=done, collection=name)

    try:
        with _open(path) as fh:
            fh.readline()  # header, checked before the upload was accepted
            for line in fh:
                if not line.strip():
                    continue
                row = json.loads(line)
                name = row["c"]
                if name not in known:  # a collection this version no longer has
                    skipped[name] = skipped.get(name, 0) + 1
                    continue
                pending.setdefault(name, []).append(row["d"])
                if len(pending[name]) >= BATCH:
                    flush(name)
            for name in list(pending):
                flush(name)
        _set(status="done", done=done, skipped=skipped, finished_at=datetime.now(timezone.utc).isoformat())
    except Exception as exc:  # noqa: BLE001 - reported to the page
        _set(status="failed", error=str(exc), done=done, finished_at=datetime.now(timezone.utc).isoformat())
    finally:
        os.remove(path)


def delete_all() -> dict[str, int]:
    """Empty every app collection (the collections and indexes stay)."""
    db = get_db()
    removed = counts()
    for name in removed:
        db.collection(name).truncate()
    return removed
