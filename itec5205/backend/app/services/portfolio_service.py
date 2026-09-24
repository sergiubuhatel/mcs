"""CRUD for saved portfolios, plus return/volatility/Sharpe-ratio estimation
from historical daily price changes stored in ``stock_prices``.
"""

import uuid
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from ..db.arango_client import get_db

TRADING_DAYS_PER_YEAR = 252


def _returns_matrix(tickers: list[str], lookback_days: int = TRADING_DAYS_PER_YEAR) -> pd.DataFrame:
    db = get_db()
    cursor = db.aql.execute(
        """
        FOR p IN stock_prices
            FILTER p.ticker IN @tickers AND p.percentage_change != null
            SORT p.date ASC
            RETURN {ticker: p.ticker, date: p.date, percentage_change: p.percentage_change}
        """,
        bind_vars={"tickers": tickers},
    )
    rows = list(cursor)
    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows)
    pivot = df.pivot_table(index="date", columns="ticker", values="percentage_change") / 100.0
    return pivot.tail(lookback_days)


def compute_metrics(holdings: list[dict]) -> dict:
    """holdings: [{ticker, weight}, ...] with weights already normalized to sum to 1."""
    tickers = [h["ticker"] for h in holdings]
    weights = np.array([h["weight"] for h in holdings], dtype=float)

    returns = _returns_matrix(tickers)
    if returns.empty:
        return {"expected_return": None, "expected_volatility": None, "sharpe_ratio": None}

    returns = returns.reindex(columns=tickers).fillna(0.0)
    portfolio_daily = returns.values @ weights

    mean_daily = portfolio_daily.mean()
    std_daily = portfolio_daily.std()
    expected_return = mean_daily * TRADING_DAYS_PER_YEAR
    expected_volatility = std_daily * np.sqrt(TRADING_DAYS_PER_YEAR)
    sharpe_ratio = float(expected_return / expected_volatility) if expected_volatility else None

    return {
        "expected_return": round(float(expected_return), 4),
        "expected_volatility": round(float(expected_volatility), 4),
        "sharpe_ratio": round(sharpe_ratio, 4) if sharpe_ratio is not None else None,
    }


def compute_performance_series(holdings: list[dict], lookback_days: int = TRADING_DAYS_PER_YEAR) -> list[dict]:
    """Historical cumulative value of the portfolio (holdings' fixed weights
    applied to each day's actual returns), normalized to start at 100 --
    the same shape of series as a stock's price history, for charting."""
    tickers = [h["ticker"] for h in holdings]
    weights = np.array([h["weight"] for h in holdings], dtype=float)

    returns = _returns_matrix(tickers, lookback_days=lookback_days)
    if returns.empty:
        return []

    returns = returns.reindex(columns=tickers).fillna(0.0)
    portfolio_daily = returns.values @ weights
    cumulative = 100.0 * np.cumprod(1.0 + portfolio_daily)

    return [{"date": d, "value": round(float(v), 2)} for d, v in zip(returns.index, cumulative)]


def _normalize_holdings(holdings: list[dict]) -> list[dict]:
    total = sum(h["weight"] for h in holdings)
    if total <= 0:
        raise ValueError("Portfolio weights must sum to a positive number")
    return [{"ticker": h["ticker"].upper(), "weight": round(h["weight"] / total, 6)} for h in holdings]


def create_portfolio(name: str, holdings: list[dict], method: str = "manual", notes: str | None = None) -> dict:
    db = get_db()
    holdings = _normalize_holdings(holdings)
    metrics = compute_metrics(holdings)

    doc = {
        "_key": str(uuid.uuid4()),
        "name": name,
        "method": method,
        "holdings": holdings,
        "notes": notes,
        "created_at": datetime.now(timezone.utc).isoformat(),
        **metrics,
    }
    db.collection("portfolios").insert(doc)
    return doc


def list_portfolios() -> list[dict]:
    db = get_db()
    return list(db.collection("portfolios").all())


def _with_company_details(holdings: list[dict]) -> list[dict]:
    """Attach each holding's company name + key stats (from `companies` /
    `stock_stats` / `calculated_stats`) for display -- stored holdings only
    ever carry ticker/weight."""
    db = get_db()
    tickers = [h["ticker"] for h in holdings]
    cursor = db.aql.execute(
        """
        FOR c IN companies
            FILTER c._key IN @tickers
            LET stats = DOCUMENT('stock_stats', c._key)
            LET calc = DOCUMENT('calculated_stats', c._key)
            RETURN {
                ticker: c._key,
                name: c.name,
                market_cap: stats.market_cap,
                trailing_pe: stats.trailing_pe,
                forward_pe: stats.forward_pe,
                peg_ratio: stats.peg_ratio,
                gross_margin: stats.gross_margin_ttm,
                operating_margin: stats.operating_margin_ttm,
                net_margin: stats.profit_margin_ttm,
                current_ratio: stats.current_ratio_mrq,
                ev_to_ebitda: stats.ev_to_ebitda,
                dividend_yield: stats.dividend_yield,
                free_cash_flow: stats.free_cash_flow,
                revenue_growth_yoy_q: stats.revenue_growth_yoy_q,
                earnings_growth_yoy_q: stats.earnings_growth_yoy_q,
                current_price: stats.current_price,
                previous_close: stats.previous_close,
                stock_growth_1y: calc.stock_growth_1y,
                volatility: calc.volatility_1y
            }
        """,
        bind_vars={"tickers": tickers},
    )
    details = {row["ticker"]: row for row in cursor}

    def day_change(detail: dict) -> float | None:
        current, previous = detail.get("current_price"), detail.get("previous_close")
        if current is None or not previous:
            return None
        return round((current - previous) / previous, 4)

    return [
        {
            **h,
            **{k: v for k, v in details.get(h["ticker"], {}).items() if k != "ticker"},
            "day_change": day_change(details.get(h["ticker"], {})),
        }
        for h in holdings
    ]


def get_portfolio(portfolio_id: str) -> dict | None:
    db = get_db()
    col = db.collection("portfolios")
    if not col.has(portfolio_id):
        return None
    doc = col.get(portfolio_id)
    doc["holdings"] = _with_company_details(doc["holdings"])
    return doc


def update_portfolio(portfolio_id: str, name: str) -> dict | None:
    db = get_db()
    col = db.collection("portfolios")
    if not col.has(portfolio_id):
        return None
    col.update({"_key": portfolio_id, "name": name})
    return col.get(portfolio_id)


def delete_portfolio(portfolio_id: str) -> bool:
    db = get_db()
    col = db.collection("portfolios")
    if not col.has(portfolio_id):
        return False
    col.delete(portfolio_id)
    return True
