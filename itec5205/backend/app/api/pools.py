"""CRUD for candidate-investment pools (saved off a screener search)."""

from flask import Blueprint, jsonify, request

from ..services.pool_service import create_pool, delete_pool, get_pool, list_pools, update_pool

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
