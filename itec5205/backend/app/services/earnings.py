"""Financial results (earnings) dates per company, from Yahoo Finance.

Two collections:
- `earnings_reports`: one document per earnings release (`_key` =
  ticker_YYYY-MM-DD) with Yahoo's EPS estimate, reported EPS and surprise %.
  Upcoming releases have no reported EPS yet.
- `earnings_dates`: one summary per company (`_key` = ticker) -- the last
  release, the next one, and the end of the last reported quarter -- read by
  the screener and the company page.

The history comes from Yahoo's earnings calendar page (at most 100 rows per
request), read and parsed here rather than through yfinance's
`get_earnings_dates`: that call caches every page for the life of the
process (a throttled page would come back on every retry) and fails with a
bare KeyError when Yahoo answers a burst with a page without the table --
which stopped ~1,800 tickers of the first whole-universe run. Here that page
raises `EarningsPageThrottled`, which the import treats like an HTTP 429
(pause all threads, retry). The first import of a company pages through its
whole history (MSFT: 113 releases since 1998); later imports fetch only the
newest page and replace the stored rows from that page's oldest date on, so a
moved release date doesn't leave a stale row.
"""

import re
from datetime import datetime, timezone
from io import StringIO
from zoneinfo import ZoneInfo

import pandas as pd
import yfinance as yf
from bs4 import BeautifulSoup

from ..db.arango_client import get_db

_MARKET_TZ = ZoneInfo("America/New_York")
PAGE_SIZE = 100  # Yahoo's cap per request
REFRESH_SIZE = 25  # newest rows re-read once the history is stored
MAX_PAGES = 5
_PAGE_URL = "https://finance.yahoo.com/calendar/earnings?symbol={}&offset={}&size={}"
_TZ_WORD = re.compile(r"\s+[A-Z]{2,4}$")  # trailing "EDT" / "EST"


def _num(value):
    try:
        number = float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return None
    return None if pd.isna(number) else round(number, 4)


class EarningsPageThrottled(Exception):
    """Yahoo's earnings page came back without its table for a company that
    has earnings -- its answer to too many requests."""


def _row(ticker: str, when: pd.Timestamp, r) -> dict:
    day = when.strftime("%Y-%m-%d")
    return {
        "_key": f"{ticker}_{day}",
        "ticker": ticker,
        "date": day,
        "time": when.isoformat(),
        "eps_estimate": _num(r.get("EPS Estimate")),
        "eps_reported": _num(r.get("Reported EPS")),
        "surprise_pct": _num(r.get("Surprise (%)")),
    }


def _when(text: str) -> pd.Timestamp | None:
    """'October 28, 2026 at 4 PM EDT' -> that time in New York."""
    stamp = pd.to_datetime(_TZ_WORD.sub("", str(text)).replace(" at ", " "), errors="coerce")
    return None if pd.isna(stamp) else stamp.tz_localize(_MARKET_TZ, ambiguous=True, nonexistent="shift_forward")


def _page(yf_ticker: yf.Ticker, ticker: str, offset: int, size: int, expected: bool) -> tuple[list[dict], int]:
    """One page of releases (rows, rows on the page). `expected`: Yahoo lists
    an earnings date for this company, so a page without the table is
    throttling, not "no earnings" (funds, very new listings)."""
    response = yf_ticker._data.get(_PAGE_URL.format(ticker, offset, size))  # uncached, see module doc
    table = BeautifulSoup(response.text, "html.parser").find("table") if response.status_code == 200 else None
    frame = pd.read_html(StringIO(str(table)), na_values=["-"])[0] if table is not None else None
    if frame is None or "Earnings Date" not in frame.columns:
        if expected or response.status_code == 429:
            raise EarningsPageThrottled(
                f"Yahoo's earnings page came back without its table (HTTP {response.status_code}); "
                "usually too many requests"
            )
        return [], 0
    rows = []
    for _, r in frame.iterrows():
        when = _when(r["Earnings Date"])
        if when is not None:
            rows.append(_row(ticker, when, r))
    return rows, len(frame)


def fetch_earnings_history(yf_ticker: yf.Ticker, ticker: str, full: bool, expected: bool) -> list[dict]:
    """Every release Yahoo lists (`full`), else only the newest ones."""
    if not full:
        return _page(yf_ticker, ticker, 0, REFRESH_SIZE, expected)[0]
    rows = []
    for page in range(MAX_PAGES):
        got, count = _page(yf_ticker, ticker, page * PAGE_SIZE, PAGE_SIZE, expected and page == 0)
        rows += got
        if count < PAGE_SIZE:
            break
    return list({r["_key"]: r for r in rows}.values())


def _epoch_day(seconds, tz=_MARKET_TZ) -> str | None:
    if not seconds:
        return None
    return datetime.fromtimestamp(seconds, tz).strftime("%Y-%m-%d")


def summarize(ticker: str, info: dict) -> dict:
    """Last and next release from the stored history; Yahoo's `info` decides
    the next date when it has one (and says whether it's only an estimate)."""
    db = get_db()
    today = datetime.now(_MARKET_TZ).strftime("%Y-%m-%d")
    reports = list(db.aql.execute(
        "FOR e IN earnings_reports FILTER e.ticker == @t SORT e.date RETURN e", bind_vars={"t": ticker},
    ))
    past = [e for e in reports if e["date"] < today or e["eps_reported"] is not None]
    upcoming = [e for e in reports if e not in past]
    last = past[-1] if past else None
    nxt = upcoming[0] if upcoming else None

    next_date = nxt["date"] if nxt else None
    # A date only on Yahoo's calendar (not in `info`) is a projection.
    confirmed = False if next_date else None
    info_next = _epoch_day(info.get("earningsTimestampStart") or info.get("earningsTimestamp"))
    if info_next and info_next >= today:
        next_date = info_next
        confirmed = not info.get("isEarningsDateEstimate", True)
    return {
        "_key": ticker,
        "last_report_date": last and last["date"],
        "last_eps_estimate": last and last["eps_estimate"],
        "last_eps_reported": last and last["eps_reported"],
        "last_surprise_pct": last and last["surprise_pct"],
        "next_report_date": next_date,
        "next_eps_estimate": nxt["eps_estimate"] if nxt and nxt["date"] == next_date else None,
        "next_confirmed": confirmed,
        "last_quarter_end": _epoch_day(info.get("mostRecentQuarter"), timezone.utc),
        "first_report_date": reports[0]["date"] if reports else None,
        "report_count": len(past),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def import_earnings(yf_ticker: yf.Ticker, ticker: str, info: dict) -> int:
    """Fetch and store `ticker`'s releases + summary; returns rows written."""
    db = get_db()
    stored = next(iter(db.aql.execute(
        "FOR e IN earnings_reports FILTER e.ticker == @t LIMIT 1 RETURN 1", bind_vars={"t": ticker},
    )), None)
    # Yahoo gives a next (or just-passed) earnings time for companies that report.
    expected = bool(info.get("earningsTimestamp") or info.get("earningsTimestampStart"))
    rows = fetch_earnings_history(yf_ticker, ticker, full=stored is None, expected=expected)
    if rows:
        oldest = min(r["date"] for r in rows)
        db.aql.execute(
            "FOR e IN earnings_reports FILTER e.ticker == @t AND e.date >= @d REMOVE e IN earnings_reports",
            bind_vars={"t": ticker, "d": oldest},
        )
        db.collection("earnings_reports").insert_many(rows, overwrite=True)
    db.collection("earnings_dates").insert(summarize(ticker, info), overwrite=True)
    return len(rows)


def earnings_for(ticker: str) -> dict:
    """Summary + full history (newest first) for the company page."""
    db = get_db()
    return {
        "summary": db.collection("earnings_dates").get(ticker),
        "reports": list(db.aql.execute(
            "FOR e IN earnings_reports FILTER e.ticker == @t SORT e.date DESC "
            "RETURN UNSET(e, '_id', '_rev', '_key')",
            bind_vars={"t": ticker},
        )),
    }
