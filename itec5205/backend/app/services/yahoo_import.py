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

# Row labels used by yfinance's financial statements, verified against a
# live pull (some labels have varied across yfinance versions, so each is
# looked up defensively via ``_row``).
INCOME_ROWS = {
    "revenue": "Total Revenue",
    "gross_profit": "Gross Profit",
    "operating_income": "Operating Income",
    "net_income": "Net Income",
}
BALANCE_ROWS = {
    "total_assets": "Total Assets",
    "total_debt": "Total Debt",
    "stockholders_equity": "Stockholders Equity",
    "current_assets": "Current Assets",
    "current_liabilities": "Current Liabilities",
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


def _row(df: pd.DataFrame, label: str, col=0):
    """Best-effort lookup of a labeled row/column in a yfinance statement
    DataFrame. Returns None if the row is missing or the value isn't numeric."""
    if df is None or df.empty or label not in df.index:
        return None
    try:
        value = df.loc[label].iloc[col]
    except (IndexError, KeyError):
        return None
    if pd.isna(value):
        return None
    return float(value)


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
    row["updated_at"] = datetime.now(timezone.utc).isoformat()
    return row


def fetch_financial_ratios(ticker: str, yf_ticker: yf.Ticker) -> dict:
    """Compute profitability/debt/liquidity ratios from the latest annual
    financial statements. Any input the statement doesn't provide is left as
    None rather than raising, since yfinance's coverage varies by ticker."""
    financials = yf_ticker.financials
    balance_sheet = yf_ticker.balance_sheet

    revenue = _row(financials, INCOME_ROWS["revenue"])
    gross_profit = _row(financials, INCOME_ROWS["gross_profit"])
    operating_income = _row(financials, INCOME_ROWS["operating_income"])
    net_income = _row(financials, INCOME_ROWS["net_income"])
    prev_revenue = _row(financials, INCOME_ROWS["revenue"], col=1)

    total_assets = _row(balance_sheet, BALANCE_ROWS["total_assets"])
    total_debt = _row(balance_sheet, BALANCE_ROWS["total_debt"])
    equity = _row(balance_sheet, BALANCE_ROWS["stockholders_equity"])
    current_assets = _row(balance_sheet, BALANCE_ROWS["current_assets"])
    current_liabilities = _row(balance_sheet, BALANCE_ROWS["current_liabilities"])

    period_end = None
    if financials is not None and not financials.empty:
        period_end = financials.columns[0].strftime("%Y-%m-%d")

    def _safe_div(a, b):
        if a is None or b in (None, 0):
            return None
        return round(a / b, 4)

    return {
        "ticker": ticker,
        "period_end": period_end,
        "revenue": revenue,
        "net_income": net_income,
        "total_assets": total_assets,
        "total_debt": total_debt,
        "total_equity": equity,
        "gross_margin": _safe_div(gross_profit, revenue),
        "operating_margin": _safe_div(operating_income, revenue),
        "net_margin": _safe_div(net_income, revenue),
        "roe": _safe_div(net_income, equity),
        "roa": _safe_div(net_income, total_assets),
        "debt_to_equity": _safe_div(total_debt, equity),
        "current_ratio": _safe_div(current_assets, current_liabilities),
        "revenue_growth_yoy": _safe_div(
            None if revenue is None or prev_revenue is None else (revenue - prev_revenue),
            prev_revenue,
        ),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def import_ticker(ticker: str, years: int = 2, interval: str = "1d") -> dict:
    """Fetch history + stats + financial ratios for one ticker and upsert
    them into ArangoDB. Returns a small summary dict for progress reporting."""
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

    latest_date = get_latest_price_date(ticker)
    history_rows = fetch_ticker_history(ticker, years=years, interval=interval, since=latest_date)
    prices_col = db.collection("stock_prices")
    for row in history_rows:
        row["_key"] = f"{ticker}_{row['date']}"
        prices_col.insert(row, overwrite=True)

    stats_row = fetch_ticker_stats(ticker, info)
    stats_row["_key"] = ticker
    db.collection("stock_stats").insert(stats_row, overwrite=True)

    ratios_row = fetch_financial_ratios(ticker, yf_ticker)
    ratios_row["_key"] = ticker
    db.collection("financial_ratios").insert(ratios_row, overwrite=True)

    return {"ticker": ticker, "company": company_name, "history_rows": len(history_rows)}
