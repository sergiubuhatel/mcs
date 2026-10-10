"""Signal board: fundamentals + RL weight + LSTM/ARIMA direction per ticker
(see services/signal_service.py for how the compound signal is formed)."""

from flask import Blueprint, jsonify, request

from ..services.pool_service import get_pool
from ..services.portfolio_service import get_portfolio
from ..services.signal_service import build_signals, latest_portfolio_for_pool

bp = Blueprint("signals", __name__, url_prefix="/api/signals")


@bp.get("")
def signals():
    """``?pool_id=`` -> the pool's tickers, its screen, and its latest RL portfolio.
    ``?portfolio_id=`` -> that portfolio's holdings and weights, plus the screen of
    the pool it was trained on (if any)."""
    pool_id = request.args.get("pool_id")
    portfolio_id = request.args.get("portfolio_id")
    if pool_id:
        pool = get_pool(pool_id)
        if pool is None:
            return jsonify({"error": "Pool not found"}), 404
        portfolio = latest_portfolio_for_pool(pool_id)
        return jsonify(build_signals(pool["tickers"], pool=pool, portfolio=portfolio))
    if portfolio_id:
        portfolio = get_portfolio(portfolio_id)
        if portfolio is None:
            return jsonify({"error": "Portfolio not found"}), 404
        pool = get_pool(portfolio["source_pool_id"]) if portfolio.get("source_pool_id") else None
        return jsonify(build_signals([h["ticker"] for h in portfolio["holdings"]], pool=pool, portfolio=portfolio))
    return jsonify({"error": "Pass 'pool_id' or 'portfolio_id'"}), 400
