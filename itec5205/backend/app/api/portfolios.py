"""CRUD for saved portfolios (manually built, or adopted from an RL run)."""

from flask import Blueprint, jsonify, request

from ..services.horizons import BAND_LEVELS, DEFAULT_BAND_LEVEL
from ..services.portfolio_forecast import portfolio_forecast
from ..services.portfolio_service import (
    combine_sleeves,
    compute_performance_series,
    create_portfolio,
    delete_portfolio,
    get_portfolio,
    list_portfolios,
    set_display,
    update_portfolio,
)
from ..services.statement_import import MAX_IMAGE_BYTES, read_statement

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


@bp.post("/combined")
def create_combined():
    """A portfolio of portfolios: {name, notes, sleeves: [{portfolio_id, allocation, note}]}."""
    body = request.get_json(force=True) or {}
    name = (body.get("name") or "").strip()
    if not name:
        return jsonify({"error": "'name' is required"}), 400
    try:
        holdings, sleeves = combine_sleeves(body.get("sleeves") or [])
        portfolio = create_portfolio(name=name, holdings=holdings, method="combined", notes=body.get("notes"), sleeves=sleeves)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify(portfolio), 201


@bp.put("/combined/<portfolio_id>")
def update_combined(portfolio_id: str):
    body = request.get_json(force=True) or {}
    name = (body.get("name") or "").strip()
    if not name:
        return jsonify({"error": "'name' is required"}), 400
    if any(s.get("portfolio_id") == portfolio_id for s in body.get("sleeves") or []):
        return jsonify({"error": "A portfolio cannot contain itself"}), 400
    try:
        holdings, sleeves = combine_sleeves(body.get("sleeves") or [])
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    portfolio = update_portfolio(portfolio_id, name=name, holdings=holdings, sleeves=sleeves, notes=body.get("notes"))
    if portfolio is None:
        return jsonify({"error": "Portfolio not found"}), 404
    return jsonify(portfolio)


@bp.post("/import-image")
def import_image():
    """OCR a brokerage positions screenshot -> positions with market values,
    for the user to review before saving it as a portfolio (nothing stored)."""
    file = request.files.get("file")
    if file is None:
        return jsonify({"error": "Choose an image of the positions table"}), 400
    data = file.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        return jsonify({"error": f"The image is larger than {MAX_IMAGE_BYTES // (1024 * 1024)} MB"}), 400
    try:
        return jsonify(read_statement(data))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400


@bp.put("/<portfolio_id>/display")
def display(portfolio_id: str):
    """Body `{"display": "sleeves" | "combined"}` -- remembered per portfolio."""
    try:
        found = set_display(portfolio_id, (request.get_json(silent=True) or {}).get("display"))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    if not found:
        return jsonify({"error": "Portfolio not found"}), 404
    return jsonify({"display": request.get_json()["display"]})


@bp.get("/<portfolio_id>/performance")
def performance(portfolio_id: str):
    portfolio = get_portfolio(portfolio_id)
    if portfolio is None:
        return jsonify({"error": "Portfolio not found"}), 404
    days = int(request.args.get("days", 500))
    series = compute_performance_series(portfolio["holdings"], lookback_days=days)
    return jsonify({"portfolio_id": portfolio_id, "series": series})


@bp.get("/<portfolio_id>/forecast")
def forecast(portfolio_id: str):
    """The portfolio's expected path (LSTM and ARIMA) and 95% band, from its
    holdings' stored forecasts -- see services/portfolio_forecast.py."""
    portfolio = get_portfolio(portfolio_id)
    if portfolio is None:
        return jsonify({"error": "Portfolio not found"}), 404
    level = request.args.get("level", DEFAULT_BAND_LEVEL, type=int)
    if level not in BAND_LEVELS:
        return jsonify({"error": f"'level' must be one of {', '.join(map(str, BAND_LEVELS))}"}), 400
    result = portfolio_forecast(portfolio["holdings"], level=level)
    if result is None:
        return jsonify({"error": "None of the holdings has a forecast yet -- run Forecast all"}), 404
    return jsonify({"portfolio_id": portfolio_id, **result})


@bp.put("/<portfolio_id>")
def update(portfolio_id: str):
    body = request.get_json(force=True) or {}
    name = body.get("name")
    if not name:
        return jsonify({"error": "'name' is required"}), 400
    portfolio = update_portfolio(portfolio_id, name=name)
    if portfolio is None:
        return jsonify({"error": "Portfolio not found"}), 404
    return jsonify(portfolio)


@bp.delete("/<portfolio_id>")
def delete(portfolio_id: str):
    if not delete_portfolio(portfolio_id):
        return jsonify({"error": "Portfolio not found"}), 404
    return jsonify({"deleted": portfolio_id})
