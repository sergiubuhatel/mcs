"""Pull price history, key statistics, and financial-statement ratios for a
ticker from Yahoo Finance and upsert them into ArangoDB.

The history/stats logic mirrors the original standalone scripts
(``fetch_stock_history.py`` / ``fetch_stock_stats.py``) at the repo root;
this module is the superset that also computes profitability/debt ratios
from the income statement, balance sheet, and cash flow statement, and
writes everything to Arango instead of CSV.
"""

import re
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pandas as pd
import yfinance as yf

from ..db.arango_client import get_db

_KEY_SAFE = re.compile(r"[^A-Za-z0-9_\-:.@()+,=;$!*'%]")

# NYSE/Nasdaq regular session close, in the exchange's own timezone -- used
# to decide whether "today" already has a final close or is still live.
_MARKET_TZ = ZoneInfo("America/New_York")
_MARKET_CLOSE_HOUR = 16


def _last_closed_session_date() -> date:
    """Most recent calendar date whose regular session has already
    finished. Before today's close this is yesterday; a weekend/holiday in
    between is harmless since yfinance never returns a row for a non-
    trading day anyway."""
    now_et = datetime.now(_MARKET_TZ)
    if now_et.hour < _MARKET_CLOSE_HOUR:
        return now_et.date() - timedelta(days=1)
    return now_et.date()


def _slugify_key(value: str) -> str:
    """ArangoDB document keys only allow a specific character set (no spaces,
    '&', '/', etc.) -- sector/industry names like 'Oil & Gas E&P' need this
    before being used as a `_key`. The original readable string is still
    stored as `name`/on `companies.sector` for display and filtering."""
    slug = _KEY_SAFE.sub("_", value.strip())
    return slug or "unknown"

# Same "info" fields as the original fetch_stock_stats.py, in output column order.
STAT_FIELDS = {
    "company": "longName",
    "sector": "sector",
    "industry": "industry",
    "current_price": "currentPrice",
    "previous_close": "previousClose",
    "open": "open",
    "day_low": "dayLow",
    "day_high": "dayHigh",
    "fifty_two_week_low": "fiftyTwoWeekLow",
    "fifty_two_week_high": "fiftyTwoWeekHigh",
    "volume": "volume",
    "average_volume": "averageVolume",
    "market_cap": "marketCap",
    "beta": "beta",
    # Fundamental screening fields (valuation / quality / growth / financial
    # health) -- all available on the same `info` dict already fetched per
    # ticker, no extra Yahoo round trip needed. This is now the sole source
    # for these ratios (the `financial_ratios` collection, which computed
    # the same concepts from annual statements via 2 extra Yahoo calls per
    # ticker, was retired in favor of these live ttm/mrq figures).
    "peg_ratio": "pegRatio",
    "ev_to_ebitda": "enterpriseToEbitda",
    "gross_margin_ttm": "grossMargins",
    "profit_margin_ttm": "profitMargins",
    "operating_margin_ttm": "operatingMargins",
    "roa_ttm": "returnOnAssets",
    "roe_ttm": "returnOnEquity",
    "revenue_growth_yoy_q": "revenueGrowth",
    # Yahoo's "Quarterly Earnings Growth (yoy)" is `earningsQuarterlyGrowth`,
    # not `earningsGrowth` (a different, non-quarterly metric) -- verified
    # against a live pull.
    "earnings_growth_yoy_q": "earningsQuarterlyGrowth",
    "debt_to_equity_mrq": "debtToEquity",
    "current_ratio_mrq": "currentRatio",
    "free_cash_flow": "freeCashflow",
    "trailing_pe": "trailingPE",
    "forward_pe": "forwardPE",
    "eps_trailing": "trailingEps",
    "eps_forward": "forwardEps",
    "dividend_yield": "dividendYield",
    "dividend_rate": "dividendRate",
    "payout_ratio": "payoutRatio",
    "book_value": "bookValue",
    "price_to_book": "priceToBook",
    "shares_outstanding": "sharesOutstanding",
    "fifty_day_average": "fiftyDayAverage",
    "two_hundred_day_average": "twoHundredDayAverage",
}

def read_tickers(path) -> list[str]:
    tickers = []
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line and not line.startswith("#"):
                tickers.append(line.upper())
    return tickers


def get_up_to_date_tickers() -> set[str]:
    """Tickers whose `stock_prices` already reach the most recent closed
    session -- i.e. have no missing price days to catch up on. Backs the
    "only update what's missing" import option: skip a ticker only when
    it's truly current, not merely present (a ticker last imported weeks
    ago is 'in the database' but still stale, and must still be caught
    up)."""
    db = get_db()
    cutoff = _last_closed_session_date().isoformat()
    cursor = db.aql.execute(
        """
        FOR p IN stock_prices
          COLLECT ticker = p.ticker AGGREGATE latest = MAX(p.date)
          FILTER latest >= @cutoff
          RETURN ticker
        """,
        bind_vars={"cutoff": cutoff},
    )
    return set(cursor)


def get_latest_price_date(ticker: str) -> str | None:
    """Most recent date already stored in `stock_prices` for this ticker
    (YYYY-MM-DD), or None if it has never been imported. Drives the
    incremental catch-up in `import_ticker` -- only sessions after this
    date get re-fetched instead of re-pulling the full lookback every time."""
    db = get_db()
    cursor = db.aql.execute(
        "FOR p IN stock_prices FILTER p.ticker == @ticker SORT p.date DESC LIMIT 1 RETURN p.date",
        bind_vars={"ticker": ticker},
    )
    results = list(cursor)
    return results[0] if results else None


def fetch_ticker_history(
    ticker: str, years: int = 2, interval: str = "1d", since: str | None = None
) -> list[dict]:
    """End-of-day close only -- a session that hasn't finished yet (checked
    against NYSE hours in America/New_York, see `_last_closed_session_date`)
    is left out entirely rather than filled with a live quote. It's simply
    picked up on the next import once it has actually closed.

    `since`, when given, is the last date already stored for this ticker
    (from `get_latest_price_date`): only that date onward is re-fetched --
    re-including `since` itself as the anchor for `previous`/`value_change`,
    but never re-emitting it -- instead of re-pulling the full `years`
    lookback on every import. Uses an explicit `start` date rather than
    yfinance's `period` enum, which only recognizes a fixed set of values
    (1y/2y/5y/10y/max) -- an explicit date supports any lookback, including
    ones like 15 or 20 years that period="..." can't express.
    """
    yf_ticker = yf.Ticker(ticker)
    start = since if since else (date.today() - timedelta(days=365 * years)).isoformat()
    history = yf_ticker.history(start=start, interval=interval)

    if history.empty:
        if since:
            return []  # already fully caught up
        raise ValueError(f"No price history returned for ticker '{ticker}'")

    cutoff = _last_closed_session_date()

    close = pd.to_numeric(history["Close"], errors="coerce")
    df = pd.DataFrame({
        "date": history.index.tz_localize(None),
        "close": close.round(2).values,
    })
    df = df.dropna(subset=["close"])
    df = df[df["date"].dt.date <= cutoff]
    if df.empty:
        return []

    df = df.sort_values("date").reset_index(drop=True)
    df["previous"] = df["close"].shift(1).round(2)
    df["value_change"] = (df["close"] - df["previous"]).round(2)
    df["percentage_change"] = ((df["close"] - df["previous"]) / df["previous"] * 100).round(2)

    if since:
        since_date = pd.Timestamp(since).date()
        df = df[df["date"].dt.date > since_date]

    rows = []
    for record in df.to_dict(orient="records"):
        date_str = record["date"].strftime("%Y-%m-%d")
        rows.append({
            "ticker": ticker,
            "date": date_str,
            "close": record["close"],
            "previous": None if pd.isna(record["previous"]) else record["previous"],
            "value_change": None if pd.isna(record["value_change"]) else record["value_change"],
            "percentage_change": None if pd.isna(record["percentage_change"]) else record["percentage_change"],
        })
    return rows


def fetch_ticker_stats(ticker: str, info: dict) -> dict:
    row = {"ticker": ticker}
    for column, field in STAT_FIELDS.items():
        row[column] = info.get(field)
    # Stored in millions (not raw dollars) -- keeps the number small/readable
    # for a mega-cap universe; every reader (screener filter, table, RL
    # top-N sort) must agree on this unit.
    if row.get("market_cap") is not None:
        row["market_cap"] = row["market_cap"] / 1_000_000
    row["updated_at"] = datetime.now(timezone.utc).isoformat()
    return row


def import_ticker(
    ticker: str,
    years: int = 2,
    interval: str = "1d",
    import_history: bool = True,
    import_statistics: bool = True,
) -> dict:
    """Fetch history and/or stats (incl. fundamental ratios, all sourced
    from `info` -- see `STAT_FIELDS`) for one ticker and upsert them into
    ArangoDB, per the `import_history`/`import_statistics` flags. Returns a
    small summary dict for progress reporting.

    Company metadata (name/sector/industry) always gets upserted regardless
    of which flags are set -- it comes from the same `info` fetch already
    needed to validate the ticker, at no extra Yahoo round trip."""
    yf_ticker = yf.Ticker(ticker)
    info = yf_ticker.info or {}
    if info.get("regularMarketPrice") is None and info.get("currentPrice") is None:
        raise ValueError(f"No data returned for ticker '{ticker}' (possibly delisted or invalid)")

    db = get_db()
    company_name = info.get("longName") or info.get("shortName") or ticker
    sector = info.get("sector")
    industry = info.get("industry")

    if sector:
        db.collection("sectors").insert({"_key": _slugify_key(sector), "name": sector}, overwrite=True)
    if industry:
        db.collection("industries").insert(
            {"_key": _slugify_key(industry), "name": industry, "sector": sector}, overwrite=True
        )

    db.collection("companies").insert(
        {
            "_key": ticker,
            "name": company_name,
            "sector": sector,
            "industry": industry,
            "exchange": info.get("exchange"),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        overwrite=True,
    )

    history_rows = []
    if import_history:
        latest_date = get_latest_price_date(ticker)
        history_rows = fetch_ticker_history(ticker, years=years, interval=interval, since=latest_date)
        prices_col = db.collection("stock_prices")
        for row in history_rows:
            row["_key"] = f"{ticker}_{row['date']}"
            prices_col.insert(row, overwrite=True)

    if import_statistics:
        stats_row = fetch_ticker_stats(ticker, info)
        stats_row["_key"] = ticker
        db.collection("stock_stats").insert(stats_row, overwrite=True)

    return {"ticker": ticker, "company": company_name, "history_rows": len(history_rows)}
