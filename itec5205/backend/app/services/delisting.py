"""Delisted companies: detected by an import, then removed from the database
and left out of every whole-list import from then on.

A ticker counts as delisted when Yahoo has no quote for it (import_ticker's
"No data returned ... possibly delisted" error) AND no price history for the
last month -- the second check keeps a passing Yahoo glitch from wiping a
live company. Typing the ticker in "Specific tickers" still tries it; if that
import succeeds, the ticker is un-marked (see `clear_delisted`).
"""

import logging
from datetime import datetime, timezone

import yfinance as yf

from ..db.arango_client import get_db

logger = logging.getLogger(__name__)

# Per-ticker documents keyed by the ticker itself.
_KEYED_BY_TICKER = ("companies", "stock_stats", "calculated_stats", "earnings_dates", "price_predictions",
                    "arima_predictions")
# Ticker lists on a pool (its members, mandatory and excluded stocks).
_POOL_LISTS = ("tickers", "required_tickers", "excluded_tickers")


def is_delisted_error(error: str) -> bool:
    return "possibly delisted" in (error or "")


def confirm_delisted(ticker: str) -> bool:
    """No price history for the last month either."""
    try:
        return yf.Ticker(ticker).history(period="1mo").empty
    except Exception:  # noqa: BLE001 - can't confirm (network, rate limit): keep the company
        return False


def delisted_tickers() -> set[str]:
    return set(get_db().aql.execute("FOR d IN delisted_tickers RETURN d._key"))


def clear_delisted(ticker: str):
    get_db().collection("delisted_tickers").delete(ticker, ignore_missing=True)


def list_delisted() -> list[dict]:
    """The delisted list, newest first (Market Data page)."""
    return list(get_db().aql.execute(
        "FOR d IN delisted_tickers SORT d.detected_at DESC "
        "RETURN {ticker: d._key, name: d.name, reason: d.reason, source: d.source || 'import', "
        "detected_at: d.detected_at, removed: d.removed}"
    ))


def purge_ticker(ticker: str, reason: str, source: str = "import") -> dict:
    """Remove every trace of `ticker` the import created (company, prices,
    stats, forecasts) and drop it from pools; record it as delisted.
    `source`: "import" (found by an import) or "manual" (added by the user
    on the Market Data page). Portfolios keep their holdings: they are a
    record of what was built."""
    db = get_db()
    company = db.collection("companies").get(ticker) or {}
    removed = {}
    for name in _KEYED_BY_TICKER:
        removed[name] = 1 if db.collection(name).delete(ticker, ignore_missing=True) else 0
    removed["stock_prices"] = len(list(db.aql.execute(
        "FOR p IN stock_prices FILTER p.ticker == @t REMOVE p IN stock_prices RETURN 1",
        bind_vars={"t": ticker},
    )))
    removed["earnings_reports"] = len(list(db.aql.execute(
        "FOR e IN earnings_reports FILTER e.ticker == @t REMOVE e IN earnings_reports RETURN 1",
        bind_vars={"t": ticker},
    )))
    removed["pools"] = len(list(db.aql.execute(
        """
        FOR p IN pools
            FILTER @t IN (p.tickers || []) OR @t IN (p.required_tickers || []) OR @t IN (p.excluded_tickers || [])
            UPDATE p WITH {
                tickers: REMOVE_VALUE(p.tickers || [], @t),
                required_tickers: REMOVE_VALUE(p.required_tickers || [], @t),
                excluded_tickers: REMOVE_VALUE(p.excluded_tickers || [], @t)
            } IN pools
            RETURN 1
        """,
        bind_vars={"t": ticker},
    )))
    db.collection("delisted_tickers").insert({
        "_key": ticker,
        "name": company.get("name"),
        "reason": reason,
        "source": source,
        "detected_at": datetime.now(timezone.utc).isoformat(),
        "removed": removed,
    }, overwrite=True)
    logger.warning("Delisted %s -- removed from the database: %s", ticker, removed)
    return removed
