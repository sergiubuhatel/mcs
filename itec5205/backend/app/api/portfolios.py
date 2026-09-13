"""CRUD for saved portfolios (manually built, or adopted from an RL run)."""

from flask import Blueprint, jsonify, request

from ..services.portfolio_service import create_portfolio, delete_portfolio, get_portfolio, list_portfolios

bp = Blueprint("portfolios", __name__, url_prefix="/api/portfolios")


@bp.get("")
def list_all():
    return jsonify({"portfolios": list_portfolios()})


@bp.get("/<portfolio_id>")
def detail(portfolio_id: str):
    portfolio = get_portfolio(portfolio_id)
    if portfolio is None:
        return jsonify({"error": "Portfolio not found"}), 404
    return jsonify(portfolio)


@bp.post("")
def create():
    body = request.get_json(force=True) or {}
    name = body.get("name")
    holdings = body.get("holdings")
    if not name or not holdings:
        return jsonify({"error": "'name' and 'holdings' ([{ticker, weight}, ...]) are required"}), 400
    try:
        portfolio = create_portfolio(name=name, holdings=holdings, method=body.get("method", "manual"), notes=body.get("notes"))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify(portfolio), 201


@bp.delete("/<portfolio_id>")
def delete(portfolio_id: str):
    if not delete_portfolio(portfolio_id):
        return jsonify({"error": "Portfolio not found"}), 404
    return jsonify({"deleted": portfolio_id})
