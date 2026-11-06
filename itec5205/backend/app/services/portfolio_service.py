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


# --------------------------------------------------------------------------
# One calculation for everything a portfolio page shows (2026-11-06).
#
# Before, the page mixed sources: the index ran to the newest close of ANY
# holding (holdings without that day counted as 0%), each holding's 1D / 1Y /
# volatility came from whenever that stock was last imported, a part's row in
# a portfolio of portfolios summed its holdings' own-latest 1D (different days),
# and expected return / Sharpe were frozen at build time. During an import the
# parent and its parts then showed numbers from different days.
#
# Now every number comes from the same daily returns, cut at the same date:
#   as_of     the latest close every CURRENT holding has (a holding more than
#             STALE_DAYS behind the newest close -- delisted / no longer
#             updated -- is held flat after its last close instead of freezing
#             the whole portfolio)
#   index     fixed weights applied to each day's returns (rebalanced daily, as
#             before). A holding with no prices yet (listed later, e.g. SPCX)
#             is left out and the others re-weighted until it trades -- it used
#             to count as cash at 0%. A missing day in the middle = unchanged.
#   1D        index at as_of vs the previous close (additive: a parent's 1D is
#             exactly its parts' 1D x their allocations)
#   1Y        points on/after as_of minus one calendar year, first -> last (the
#             chart's 1Y window); volatility = annualized sample std. dev. of
#             the daily returns inside it; expected return = their mean x 252;
#             Sharpe = expected return / volatility (no risk-free rate).
# --------------------------------------------------------------------------

STALE_DAYS = 7


def _daily_returns(tickers: list[str], lookback_days: int) -> pd.DataFrame:
    """Daily fractional returns (rows = dates, columns = tickers), NaN where a
    ticker has no close that day. Same date-bounded read as _returns_matrix."""
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
    window_days = min(int(lookback_days * 1.6) + 14, 365 * 100)
    since = (pd.Timestamp(latest) - pd.Timedelta(days=window_days)).strftime("%Y-%m-%d")
    rows = list(db.aql.execute(
        """
        FOR p IN stock_prices
            FILTER p.ticker IN @tickers AND p.date >= @since AND p.percentage_change != null
            RETURN {ticker: p.ticker, date: p.date, r: p.percentage_change}
        """,
        bind_vars={"tickers": tickers, "since": since},
    ))
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows).pivot_table(index="date", columns="ticker", values="r") / 100.0
    # Markets are shut on weekends: a stray Saturday/Sunday row (e.g. AAPL and
    # TSLA on Sunday 2026-09-20, 0%) would add a fake trading day for some holdings only.
    df = df[pd.to_datetime(df.index).dayofweek < 5]
    return df.sort_index().tail(lookback_days + 1)


def _as_of(returns: pd.DataFrame, tickers: list[str]) -> str | None:
    """Latest date every current holding has a close (see STALE_DAYS)."""
    last = {t: returns[t].last_valid_index() for t in tickers if t in returns.columns}
    last = {t: d for t, d in last.items() if d is not None}
    if not last:
        return None
    newest = pd.Timestamp(max(last.values()))
    current = [d for d in last.values() if newest - pd.Timestamp(d) <= pd.Timedelta(days=STALE_DAYS)]
    return min(current)


def _index_returns(returns: pd.DataFrame, tickers: list[str], weights: np.ndarray) -> np.ndarray:
    """Daily returns of fixed `weights` (see the block comment): holdings not
    listed yet are left out and the rest re-weighted; gaps after listing = 0."""
    m = returns.reindex(columns=tickers)
    listed = m.notna().cumsum().gt(0).to_numpy()
    w = np.where(listed, weights, 0.0)
    total = w.sum(axis=1, keepdims=True)
    w = np.divide(w, total, out=np.zeros_like(w), where=total > 0)
    return (m.fillna(0.0).to_numpy() * w).sum(axis=1)


def _portfolio_daily(returns: pd.DataFrame, holdings: list[dict], sleeves: list[dict] | None) -> np.ndarray:
    """Daily index returns. A portfolio of portfolios is built from its parts
    (allocation x each part's own index), so a part that re-weights while one
    of its stocks is not listed yet does so inside the part -- the parent's
    1D and expected return are then exactly the parts' ones x allocations."""
    if not sleeves:
        return _index_returns(returns, [h["ticker"] for h in holdings], np.array([h["weight"] for h in holdings], dtype=float))
    total = sum(float(s["allocation"]) for s in sleeves) or 1.0
    daily = np.zeros(len(returns))
    for s in sleeves:
        hs = s["holdings"]
        part = _index_returns(returns, [h["ticker"] for h in hs], np.array([h.get("weight_in_part", h["weight"]) for h in hs], dtype=float))
        daily += float(s["allocation"]) / total * part
    return daily


def _own_rows(returns: pd.DataFrame, tickers: list[str]) -> pd.DataFrame:
    """Only the dates on which at least one of `tickers` traded -- what that
    portfolio's own page reads (days only OTHER holdings have are not its days)."""
    cols = [t for t in tickers if t in returns.columns]
    return returns[returns[cols].notna().any(axis=1)] if cols else returns.iloc[0:0]


def _window_metrics(dates: list[str], daily: np.ndarray, as_of: str) -> dict:
    """1D / 1Y / volatility / expected return / Sharpe of one daily-return series ending at as_of."""
    out = {"day_change": None, "previous_date": None, "change_1y": None, "volatility_1y": None,
           "expected_return_1y": None, "sharpe_1y": None, "window_start": None}
    if len(daily) >= 2:
        out["day_change"] = round(float(daily[-1]), 6)
        out["previous_date"] = dates[-2]
    cutoff = (pd.Timestamp(as_of) - pd.DateOffset(years=1)).strftime("%Y-%m-%d")
    start = next((i for i, d in enumerate(dates) if d >= cutoff), None)
    if start is None or len(dates) - start < 2:
        return out
    window = daily[start + 1:]  # the first point is the base: its own return is not in the window
    out["window_start"] = dates[start]
    out["change_1y"] = round(float(np.prod(1.0 + window) - 1.0), 6)
    if len(window) >= 2:
        vol = float(np.std(window, ddof=1) * np.sqrt(TRADING_DAYS_PER_YEAR))
        exp = float(np.mean(window) * TRADING_DAYS_PER_YEAR)
        out["volatility_1y"] = round(vol, 6)
        out["expected_return_1y"] = round(exp, 6)
        out["sharpe_1y"] = round(exp / vol, 4) if vol else None
    return out


def analyze_portfolio(holdings: list[dict], sleeves: list[dict] | None = None,
                      lookback_days: int = TRADING_DAYS_PER_YEAR) -> dict:
    """Index series + every metric of the portfolio page, all as of one date:
    the portfolio, each holding, and (portfolio of portfolios) each part."""
    tickers = [h["ticker"] for h in holdings]
    returns = _daily_returns(tickers, max(lookback_days, TRADING_DAYS_PER_YEAR + 10))
    as_of = _as_of(returns, tickers) if not returns.empty else None
    if as_of is None:
        return {"as_of": None, "series": [], "summary": None, "holdings": {}, "sleeves": []}
    returns = _own_rows(returns.loc[:as_of], tickers)
    dates = [str(d) for d in returns.index]

    def metrics_of(ts, ws):
        own = _own_rows(returns, ts)
        return _window_metrics([str(d) for d in own.index], _index_returns(own, ts, np.array(ws, dtype=float)), as_of)

    daily = _portfolio_daily(returns, holdings, sleeves)
    shown = min(len(dates), lookback_days + 1)
    values = 100.0 * np.cumprod(1.0 + daily[-shown:])
    series = [{"date": d, "value": round(float(v), 2)} for d, v in zip(dates[-shown:], values)]

    summary = _window_metrics(dates, daily, as_of)
    per_holding = {}
    for t in tickers:
        m = metrics_of([t], [1.0])
        first = returns[t].first_valid_index() if t in returns.columns else None
        last = returns[t].last_valid_index() if t in returns.columns else None
        # Trading for less than the 1Y window: its 1Y is "since listing".
        m["listed_since"] = str(first) if first is not None and summary["window_start"] and str(first) > summary["window_start"] else None
        m["last_close"] = str(last) if last is not None else None
        m["stale"] = bool(last is not None and str(last) < as_of)
        if not first:
            m = {k: None for k in m}
        per_holding[t] = m

    parts = [
        {"portfolio_id": s.get("portfolio_id"), "name": s.get("name"),
         **metrics_of([h["ticker"] for h in s["holdings"]], [h.get("weight_in_part", h["weight"]) for h in s["holdings"]])}
        for s in (sleeves or [])
    ]
    if parts:
        # The index keeps the allocations every day (rebalanced daily), so its 1Y
        # is not the parts' 1Y x allocations; that sum is what holding the parts
        # unchanged since the start of the window would have made.
        total = sum(float(s["allocation"]) for s in sleeves) or 1.0
        if all(p["change_1y"] is not None for p in parts):
            summary["change_1y_held"] = round(sum(float(s["allocation"]) / total * p["change_1y"] for s, p in zip(sleeves, parts)), 6)
    return {"as_of": as_of, "series": series, "summary": summary, "holdings": per_holding, "sleeves": parts}


def live_metrics(portfolios: list[dict]) -> dict:
    """{portfolio key: summary} for many portfolios with ONE price read (Portfolios list)."""
    tickers = list(dict.fromkeys(h["ticker"] for p in portfolios for h in p.get("holdings", [])))
    if not tickers:
        return {}
    returns = _daily_returns(tickers, TRADING_DAYS_PER_YEAR + 10)
    out = {}
    for p in portfolios:
        ts = [h["ticker"] for h in p.get("holdings", [])]
        as_of = _as_of(returns, ts) if ts and not returns.empty else None
        if as_of is None:
            continue
        r = _own_rows(returns.loc[:as_of], ts)
        daily = _portfolio_daily(r, p["holdings"], p.get("sleeves"))
        out[p["_key"]] = {"as_of": as_of, **_window_metrics([str(d) for d in r.index], daily, as_of)}
    return out


def _normalize_holdings(holdings: list[dict]) -> list[dict]:
    total = sum(h["weight"] for h in holdings)
    if total <= 0:
        raise ValueError("Portfolio weights must sum to a positive number")
    return [{"ticker": h["ticker"].upper(), "weight": round(h["weight"] / total, 6)} for h in holdings]


def create_portfolio(
    name: str,
    holdings: list[dict],
    method: str = "manual",
    notes: str | None = None,
    source_pool_id: str | None = None,
    sleeves: list[dict] | None = None,
) -> dict:
    db = get_db()
    holdings = _normalize_holdings(holdings)
    metrics = compute_metrics(holdings)

    doc = {
        "_key": str(uuid.uuid4()),
        "name": name,
        "method": method,
        "holdings": holdings,
        "notes": notes,
        # The pool an RL portfolio was trained on (signal board + refinement lineage).
        "source_pool_id": source_pool_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        **metrics,
    }
    if sleeves:
        doc["sleeves"] = sleeves  # a portfolio of portfolios: see combine_sleeves
    db.collection("portfolios").insert(doc)
    return doc


ALLOCATION_TOLERANCE = 0.05  # percentage points; typed shares like 33.33 x 3


def combine_sleeves(sleeves: list[dict]) -> tuple[list[dict], list[dict]]:
    """A portfolio of portfolios. `sleeves` = [{portfolio_id, allocation (% of
    the total), note}]; each saved portfolio's weights are scaled by its
    allocation and a stock held by several is added up. Returns (holdings,
    sleeve snapshots) -- the snapshot keeps each part's name and holdings as
    they were, so the combined portfolio does not change when a part is later
    edited or deleted."""
    if not sleeves:
        raise ValueError("Choose at least one portfolio")
    ids = [s.get("portfolio_id") for s in sleeves]
    if len(set(ids)) != len(ids):
        raise ValueError("A portfolio can only be added once")
    try:
        allocations = [float(s.get("allocation")) for s in sleeves]
    except (TypeError, ValueError):
        raise ValueError("Every portfolio needs an allocation (%)") from None
    if any(a <= 0 for a in allocations):
        raise ValueError("Allocations must be above 0%")
    if abs(sum(allocations) - 100) > ALLOCATION_TOLERANCE:
        raise ValueError(f"Allocations must add up to 100% (they add up to {sum(allocations):g}%)")

    col = get_db().collection("portfolios")
    totals: dict[str, float] = {}
    snapshots = []
    for sleeve, allocation in zip(sleeves, allocations):
        part = col.get(sleeve["portfolio_id"]) if sleeve["portfolio_id"] else None
        if part is None:
            raise ValueError(f"Portfolio {sleeve['portfolio_id']} not found")
        share = allocation / sum(allocations)
        for h in part["holdings"]:
            totals[h["ticker"]] = totals.get(h["ticker"], 0.0) + share * h["weight"]
        snapshots.append({
            "portfolio_id": part["_key"],
            "name": part["name"],
            "allocation": round(allocation, 4),
            "note": (sleeve.get("note") or "").strip() or None,
            "holdings": [{"ticker": h["ticker"], "weight": h["weight"]} for h in part["holdings"]],
        })
    holdings = sorted(({"ticker": t, "weight": w} for t, w in totals.items()), key=lambda h: -h["weight"])
    return holdings, snapshots


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
            LET earn = DOCUMENT('earnings_dates', c._key)
            RETURN {
                ticker: c._key,
                name: c.name,
                last_report_date: earn.last_report_date,
                next_report_date: earn.next_report_date,
                next_report_confirmed: earn.next_confirmed,
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
    if doc.get("sleeves"):
        # Each part's holdings with the same company details; `weight` = share
        # of the whole portfolio, `weight_in_part` = share inside the part.
        details = {h["ticker"]: h for h in doc["holdings"]}
        for sleeve in doc["sleeves"]:
            share = sleeve["allocation"] / 100
            sleeve["exists"] = col.has(sleeve["portfolio_id"])  # can still be opened
            sleeve["holdings"] = [
                {**details.get(h["ticker"], {"ticker": h["ticker"]}), "weight": h["weight"] * share, "weight_in_part": h["weight"]}
                for h in sleeve["holdings"]
            ]
    return doc


DISPLAYS = ("sleeves", "combined")


def set_display(portfolio_id: str, display: str) -> bool:
    """How a portfolio of portfolios is shown: by part ("sleeves", the
    default) or as one combined list of holdings ("combined")."""
    if display not in DISPLAYS:
        raise ValueError(f"'display' must be one of {', '.join(DISPLAYS)}")
    col = get_db().collection("portfolios")
    if not col.has(portfolio_id):
        return False
    col.update({"_key": portfolio_id, "display": display})
    return True


def update_portfolio(portfolio_id: str, name: str, **changes) -> dict | None:
    """Rename; a combined portfolio can also get new `holdings`, `sleeves`
    and `notes` (its metrics are then recomputed)."""
    db = get_db()
    col = db.collection("portfolios")
    if not col.has(portfolio_id):
        return None
    doc = {"_key": portfolio_id, "name": name, "updated_at": datetime.now(timezone.utc).isoformat()}
    if "holdings" in changes:
        doc["holdings"] = _normalize_holdings(changes["holdings"])
        doc.update(compute_metrics(doc["holdings"]))
    doc.update({k: changes[k] for k in ("sleeves", "notes") if k in changes})
    col.update(doc)
    return col.get(portfolio_id)


def delete_portfolio(portfolio_id: str) -> bool:
    db = get_db()
    col = db.collection("portfolios")
    if not col.has(portfolio_id):
        return False
    col.delete(portfolio_id)
    return True
