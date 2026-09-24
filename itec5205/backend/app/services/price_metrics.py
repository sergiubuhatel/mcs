"""Per-ticker price-history metrics derived from `stock_prices`, shared by
the screener grid and the portfolio detail view."""

import pandas as pd

from ..db.arango_client import get_db

TRADING_DAYS_PER_YEAR = 252


def price_history_metrics(tickers: list[str]) -> dict[str, dict]:
    """Per-ticker {growth_1y, volatility_1y}, computed in one pass over
    price history. Callers should scope `tickers` to what's actually on
    screen (e.g. one page of the grid, or one portfolio's holdings) --
    this pulls full price history for every ticker in the list."""
    if not tickers:
        return {}
    db = get_db()
    cursor = db.aql.execute(
        """
        FOR p IN stock_prices
            FILTER p.ticker IN @tickers AND p.close != null
            SORT p.date ASC
            RETURN {ticker: p.ticker, close: p.close, percentage_change: p.percentage_change}
        """,
        bind_vars={"tickers": tickers},
    )
    rows = list(cursor)
    if not rows:
        return {}

    df = pd.DataFrame(rows)
    metrics: dict[str, dict] = {}
    for ticker, g in df.groupby("ticker"):
        recent = g.tail(TRADING_DAYS_PER_YEAR + 1)

        first, last = recent["close"].iloc[0], recent["close"].iloc[-1]
        growth = round(float(last / first - 1), 4) if len(recent) >= 2 and first else None

        pct = recent["percentage_change"].dropna() / 100.0
        volatility = round(float(pct.std() * (TRADING_DAYS_PER_YEAR**0.5)), 4) if len(pct) >= 2 else None

        metrics[ticker] = {"growth_1y": growth, "volatility_1y": volatility}
    return metrics
