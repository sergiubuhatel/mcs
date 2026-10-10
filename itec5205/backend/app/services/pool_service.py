"""Candidate-investment pools: a named subset of tickers a user saves off a
screener search (`/api/companies?...`), which then becomes the universe fed
into RL training. This is the explicit middle step of the intended
workflow: search by indicators -> save a pool -> run RL on that pool.
"""

import uuid
from datetime import datetime, timezone

from ..db.arango_client import get_db


def create_pool(name: str, tickers: list[str], filters: dict | None = None, lineage: dict | None = None) -> dict:
    """`filters` holds the screener search the pool came from (sector/industry/
    q/ranges, in API units) so the fundamentals check can be re-run later.
    `lineage` is set only for refined pools (see `refine_pool`)."""
    if not tickers:
        raise ValueError("A pool needs at least one ticker")
    db = get_db()
    key = str(uuid.uuid4())
    doc = {
        "_key": key,
        "name": name,
        "tickers": [t.upper() for t in tickers],
        "filters": filters or {},
        "created_at": datetime.now(timezone.utc).isoformat(),
        # Refinement loop: iteration 0 is a pool saved off the screener;
        # each refinement makes a child with iteration + 1 under the same root.
        "root_pool_id": key,
        "parent_pool_id": None,
        "iteration": 0,
        **(lineage or {}),
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


def refine_pool(pool_id: str, drop: list[str], reason: dict | None = None, name: str | None = None) -> dict:
    """Refinement loop step: a new pool = parent minus `drop`, one iteration
    deeper under the same root. `reason` records the evidence behind each
    dropped ticker (its signal-board row) so iterations stay explainable."""
    parent = get_pool(pool_id)
    if parent is None:
        raise LookupError("Pool not found")
    drop_set = {t.upper() for t in drop}
    kept = [t for t in parent["tickers"] if t not in drop_set]
    if len(kept) < 2:
        raise ValueError("Refinement would leave fewer than 2 tickers")
    iteration = parent.get("iteration", 0) + 1
    root_id = parent.get("root_pool_id") or parent["_key"]
    base_name = parent["name"].split(" · iteration ")[0]
    return create_pool(
        name=name or f"{base_name} · iteration {iteration}",
        tickers=kept,
        filters=parent.get("filters"),
        lineage={
            "root_pool_id": root_id,
            "parent_pool_id": parent["_key"],
            "iteration": iteration,
            "dropped": sorted(drop_set & set(parent["tickers"])),
            "refine_reason": reason or {},
        },
    )


def pool_lineage(pool_id: str) -> list[dict]:
    """Every pool in the same refinement tree, by iteration, each with its
    latest RL portfolio's metrics -- the RQ3 comparison across iterations."""
    pool = get_pool(pool_id)
    if pool is None:
        return []
    root_id = pool.get("root_pool_id") or pool["_key"]
    db = get_db()
    return list(db.aql.execute(
        """
        FOR p IN pools
            FILTER p._key == @root OR p.root_pool_id == @root
            LET portfolio = FIRST(
                FOR f IN portfolios
                    FILTER f.source_pool_id == p._key
                    SORT f.created_at DESC
                    LIMIT 1
                    RETURN f
            )
            SORT p.iteration ASC, p.created_at ASC
            RETURN {
                pool_id: p._key, name: p.name, iteration: p.iteration || 0,
                parent_pool_id: p.parent_pool_id, tickers: LENGTH(p.tickers),
                dropped: p.dropped || [], created_at: p.created_at,
                portfolio: portfolio == null ? null : {
                    portfolio_id: portfolio._key, name: portfolio.name,
                    holdings: LENGTH(portfolio.holdings),
                    annual_return: portfolio.annual_return,
                    expected_volatility: portfolio.expected_volatility,
                    sharpe_ratio: portfolio.sharpe_ratio,
                    created_at: portfolio.created_at
                }
            }
        """,
        bind_vars={"root": root_id},
    ))
