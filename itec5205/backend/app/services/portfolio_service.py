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
    """Daily fractional returns, one column per ticker, last `lookback_days`
    rows. Only a date window wide enough for that many trading days is read
    (~1.6 calendar days per trading day, plus slack for holidays), via the
    persistent [ticker, date] index -- reading every ticker's full stored
    history just to keep its last year made the fetch the dominant cost of
    RL selection over a large pool."""
    db = get_db()
    latest = next(db.aql.execute(
        """
        FOR t IN @tickers
            LET d = FIRST(FOR p IN stock_prices FILTER p.ticker == t SORT p.date DESC LIMIT 1 RETURN p.date)
            COLLECT AGGREGATE latest = MAX(d)
            RETURN latest
        """,
        bind_vars={"tickers": tickers},
    ), None)
    if latest is None:
        return pd.DataFrame()
    window_days = min(int(lookback_days * 1.6) + 14, 365 * 100)  # capped: "everything" callers pass a huge lookback
    since = (pd.Timestamp(latest) - pd.Timedelta(days=window_days)).strftime("%Y-%m-%d")
    cursor = db.aql.execute(
        """
        FOR p IN stock_prices
            FILTER p.ticker IN @tickers AND p.date >= @since AND p.percentage_change != null
            SORT p.date ASC
            RETURN {ticker: p.ticker, date: p.date, percentage_change: p.percentage_change}
        """,
        bind_vars={"tickers": tickers, "since": since},
    )
    rows = list(cursor)
    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows)
    pivot = df.pivot_table(index="date", columns="ticker", values="percentage_change") / 100.0
    return pivot.tail(lookback_days)


def returns_past_year(tickers: list[str]) -> pd.DataFrame:
    """Daily returns over exactly the window the portfolio page's "1Y" change
    uses (frontend `filterByInterval`): chart points dated on/after the same
    calendar date one year before the latest one. That change is measured
    from the first such point, so its own day's return is excluded. Keeping
    the two identical matters for a return floor: a portfolio that clears
    100% by a hair over 252 rows can show 98% on a window one day shorter."""
    df = _returns_matrix(tickers, lookback_days=TRADING_DAYS_PER_YEAR + 10)
    if df.empty:
        return df
    dates = pd.to_datetime(pd.Series(df.index))
    cutoff = dates.iloc[-1] - pd.DateOffset(years=1)
    first_in_window = int((dates >= cutoff).to_numpy().argmax())
    return df.iloc[first_in_window + 1 :]


def compute_metrics(holdings: list[dict]) -> dict:
    """holdings: [{ticker, weight}, ...] with weights already normalized to sum to 1."""
    tickers = [h["ticker"] for h in holdings]
    weights = np.array([h["weight"] for h in holdings], dtype=float)

    returns = returns_past_year(tickers)
    if returns.empty:
        return {"expected_return": None, "annual_return": None, "expected_volatility": None, "sharpe_ratio": None}

    return metrics_from_returns(returns.reindex(columns=tickers).fillna(0.0).values, weights)


def metrics_from_returns(returns: np.ndarray, weights: np.ndarray) -> dict:
    """Annualized return/volatility/Sharpe of fixed `weights` applied to a
    (days, assets) matrix of fractional daily returns -- `compute_metrics`
    without the DB fetch, for scoring many candidate weightings at once."""
    portfolio_daily = returns @ weights

    mean_daily = portfolio_daily.mean()
    std_daily = portfolio_daily.std()
    expected_return = mean_daily * TRADING_DAYS_PER_YEAR
    expected_volatility = std_daily * np.sqrt(TRADING_DAYS_PER_YEAR)
    sharpe_ratio = float(expected_return / expected_volatility) if expected_volatility else None
    # Realized, compounded return over the window (value at the end / value
    # at the start - 1) -- what the portfolio actually grew by, the same idea
    # as a stock's Change (1Y), unlike the mean-based expected_return.
    annual_return = float(np.prod(1.0 + portfolio_daily) - 1.0)

    return {
        "expected_return": round(float(expected_return), 4),
        "annual_return": round(annual_return, 4),
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
