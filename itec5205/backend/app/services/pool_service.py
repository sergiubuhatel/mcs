"""Candidate-investment pools: a named subset of tickers a user saves off a
screener search (`/api/companies?...`), which then becomes the universe fed
into RL training. This is the explicit middle step of the intended
workflow: search by indicators -> save a pool -> run RL on that pool.
"""

import uuid
from datetime import datetime, timezone

from ..db.arango_client import get_db


def create_pool(name: str, tickers: list[str], filters: dict | None = None) -> dict:
    if not tickers:
        raise ValueError("A pool needs at least one ticker")
    db = get_db()
    doc = {
        "_key": str(uuid.uuid4()),
        "name": name,
        "tickers": [t.upper() for t in tickers],
        "filters": filters or {},
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    db.collection("pools").insert(doc)
    return doc


def list_pools() -> list[dict]:
    db = get_db()
    return list(db.collection("pools").all())


def get_pool(pool_id: str) -> dict | None:
    db = get_db()
    col = db.collection("pools")
    return col.get(pool_id) if col.has(pool_id) else None


def update_pool(pool_id: str, name: str | None = None, tickers: list[str] | None = None) -> dict | None:
    db = get_db()
    col = db.collection("pools")
    if not col.has(pool_id):
        return None
    if tickers is not None and not tickers:
        raise ValueError("A pool needs at least one ticker")

    patch = {}
    if name is not None:
        patch["name"] = name
    if tickers is not None:
        patch["tickers"] = [t.upper() for t in tickers]
    if patch:
        col.update({"_key": pool_id, **patch})
    return col.get(pool_id)


def delete_pool(pool_id: str) -> bool:
    db = get_db()
    col = db.collection("pools")
    if not col.has(pool_id):
        return False
    col.delete(pool_id)
    return True
