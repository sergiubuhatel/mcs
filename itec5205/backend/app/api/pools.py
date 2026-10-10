"""CRUD for candidate-investment pools (saved off a screener search)."""

from flask import Blueprint, jsonify, request

from ..services.pool_service import create_pool, delete_pool, get_pool, list_pools, pool_lineage, refine_pool, update_pool
from ..services.signal_service import SIGNAL_AVOID, SIGNAL_STRONG, SIGNAL_WEAK, build_signals, latest_portfolio_for_pool

bp = Blueprint("pools", __name__, url_prefix="/api/pools")


@bp.get("")
def list_all():
    return jsonify({"pools": list_pools()})


@bp.get("/<pool_id>")
def detail(pool_id: str):
    pool = get_pool(pool_id)
    if pool is None:
        return jsonify({"error": "Pool not found"}), 404
    return jsonify(pool)


@bp.post("")
def create():
    body = request.get_json(force=True) or {}
    name = body.get("name")
    tickers = body.get("tickers")
    if not name or not tickers:
        return jsonify({"error": "'name' and 'tickers' are required"}), 400
    try:
        pool = create_pool(name=name, tickers=tickers, filters=body.get("filters"))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify(pool), 201


@bp.put("/<pool_id>")
def update(pool_id: str):
    body = request.get_json(force=True) or {}
    name = body.get("name")
    tickers = body.get("tickers")
    if name is None and tickers is None:
        return jsonify({"error": "Nothing to update -- pass 'name' and/or 'tickers'"}), 400
    try:
        pool = update_pool(pool_id, name=name, tickers=tickers)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    if pool is None:
        return jsonify({"error": "Pool not found"}), 404
    return jsonify(pool)


@bp.delete("/<pool_id>")
def delete(pool_id: str):
    if not delete_pool(pool_id):
        return jsonify({"error": "Pool not found"}), 404
    return jsonify({"deleted": pool_id})


@bp.post("/<pool_id>/refine")
def refine(pool_id: str):
    """Refinement loop: a child pool without the given tickers. Pass
    ``{"drop": [...]}`` explicitly, or a rule over the current compound signal:
    ``"drop_weak"`` drops Weak and Avoid; ``"keep_strong"`` keeps only Strong
    (once RL holds every ticker, nothing is Weak any more, so this is the
    rule that still narrows the pool)."""
    body = request.get_json(silent=True) or {}
    pool = get_pool(pool_id)
    if pool is None:
        return jsonify({"error": "Pool not found"}), 404

    board = build_signals(pool["tickers"], pool=pool, portfolio=latest_portfolio_for_pool(pool_id))
    by_ticker = {r["ticker"]: r for r in board["rows"]}
    rule = body.get("rule")
    if rule == "drop_weak":
        drop = [r["ticker"] for r in board["rows"] if r["signal"] in (SIGNAL_WEAK, SIGNAL_AVOID)]
    elif rule == "keep_strong":
        drop = [r["ticker"] for r in board["rows"] if r["signal"] != SIGNAL_STRONG]
    else:
        drop = [t.upper() for t in body.get("drop") or []]
    if not drop:
        return jsonify({"error": "Nothing to drop for this rule"}), 400

    reason = {t: {k: by_ticker[t].get(k) for k in ("signal", "stars", "agreement")} for t in drop if t in by_ticker}
    reason["_rule"] = rule or "manual"
    try:
        child = refine_pool(pool_id, drop=drop, reason=reason, name=body.get("name"))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify(child), 201


@bp.get("/<pool_id>/lineage")
def lineage(pool_id: str):
    if get_pool(pool_id) is None:
        return jsonify({"error": "Pool not found"}), 404
    return jsonify({"iterations": pool_lineage(pool_id)})
