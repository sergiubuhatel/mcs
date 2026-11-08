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
        return {"expected_return": None, "annual_return": None, "expected_volatility": None, "sharpe_ratio": None,
                "max_drawdown": None}

    return metrics_from_returns(returns.reindex(columns=tickers).fillna(0.0).values, weights)


def max_drawdown(value: np.ndarray) -> float | None:
    """Largest fall from a running peak of a value path, as a positive
    fraction (0.12 = the value dropped 12% below its earlier high at worst)."""
    v = np.asarray(value, dtype=float)
    if len(v) < 2 or not np.all(np.isfinite(v)) or np.any(v <= 0):
        return None
    return float(max(0.0, -(v / np.maximum.accumulate(v) - 1.0).min()))


def metrics_from_returns(returns: np.ndarray, weights: np.ndarray) -> dict:
    """Annualized return/volatility/Sharpe and the max drawdown of fixed
    `weights` applied to a (days, assets) matrix of fractional daily returns
    -- `compute_metrics` without the DB fetch, for scoring many candidate
    weightings at once."""
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
    # Worst peak-to-trough fall of the held value over the same window (the
    # path starts at 1 before the first day's return).
    drawdown = max_drawdown(np.concatenate([[1.0], np.cumprod(1.0 + portfolio_daily)]))

    return {
        "expected_return": round(float(expected_return), 4),
        "annual_return": round(annual_return, 4),
        "expected_volatility": round(float(expected_volatility), 4),
        "sharpe_ratio": round(sharpe_ratio, 4) if sharpe_ratio is not None else None,
        "max_drawdown": None if drawdown is None else round(drawdown, 4),
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
# One calculation for everything a portfolio page shows (reworked 2026-11-06).
#
# Before, the page mixed sources and days: the index ran to the newest close of
# ANY holding, each holding's numbers came from whenever it was last imported,
# a part's row summed its holdings' own-latest 1D, expected return / Sharpe
# were frozen at build time, and the 1Y of a portfolio was a daily-rebalanced
# index that never equals its holdings' 1Y x weights. Now:
#
#   as_of      ONE date for the whole app: the latest close (almost) every
#              company has -- data_as_of(); during an import every page stays
#              on the previous complete day, then all move together. A
#              portfolio whose own holdings stop earlier (delisted / failed)
#              uses their latest common close; a holding more than STALE_DAYS
#              behind is held flat instead of freezing the portfolio.
#   1D         that day's return at the portfolio's weights:
#              Σ weight x stock 1D -- a parent's 1D = Σ allocation x part 1D.
#   periods    (1Y tile, chart ranges, holdings' and parts' 1Y, Portfolios
#              list) BUY AND HOLD: the weights are bought at the first close of
#              the period and held. A stock that starts trading later gets its
#              money at its first close (cash at 0% until then). So every
#              period change adds up exactly:
#                portfolio = Σ weight x holding change,
#                parent    = Σ allocation x part change.
#   1Y         from the first close on/after as_of minus one calendar year (the
#              chart's 1Y window); volatility = annualized sample std. dev. of
#              the held portfolio's daily returns in that window, expected
#              return = their mean x 252, Sharpe = expected / volatility (no
#              risk-free rate). Volatility does not add up across holdings.
# --------------------------------------------------------------------------

import time as _time

STALE_DAYS = 7
COMPLETE_SHARE = 0.98  # share of current companies that must have a day's close
_DATA_AS_OF = {"at": 0.0, "value": None}
_DATA_AS_OF_TTL = 120  # seconds


def data_as_of() -> str | None:
    """Latest date at least COMPLETE_SHARE of the current companies have a
    close for (current = latest close within STALE_DAYS of the newest one).
    While an import is part-way through a new day, this is still the previous
    day. Cached for two minutes."""
    if _time.monotonic() - _DATA_AS_OF["at"] < _DATA_AS_OF_TTL:
        return _DATA_AS_OF["value"]
    rows = list(get_db().aql.execute(
        """
        FOR c IN companies
            LET d = FIRST(FOR p IN stock_prices FILTER p.ticker == c._key SORT p.date DESC LIMIT 1 RETURN p.date)
            FILTER d != null
            COLLECT day = d WITH COUNT INTO n
            RETURN {day, n}
        """
    ))
    value = None
    if rows:
        newest = max(pd.Timestamp(r["day"]) for r in rows)
        current = sorted((r for r in rows if newest - pd.Timestamp(r["day"]) <= pd.Timedelta(days=STALE_DAYS)),
                         key=lambda r: r["day"], reverse=True)
        total = sum(r["n"] for r in current)
        reached = 0
        for r in current:
            reached += r["n"]
            if reached >= COMPLETE_SHARE * total:
                value = r["day"]
                break
    _DATA_AS_OF.update(at=_time.monotonic(), value=value)
    return value


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
    """The portfolio's date: data_as_of(), or earlier if its current holdings'
    latest common close is earlier (see STALE_DAYS)."""
    last = {t: returns[t].last_valid_index() for t in tickers if t in returns.columns}
    last = {t: str(d) for t, d in last.items() if d is not None}
    if not last:
        return None
    newest = pd.Timestamp(max(last.values()))
    current = [d for d in last.values() if newest - pd.Timestamp(d) <= pd.Timedelta(days=STALE_DAYS)]
    own = min(current)
    complete = data_as_of()
    return min(own, complete) if complete else own


def _index_returns(returns: pd.DataFrame, tickers: list[str], weights: np.ndarray) -> np.ndarray:
    """Daily returns of fixed weights rebalanced daily (holdings not listed yet
    left out, the rest re-weighted; gaps after listing = 0). Used for 1D and by
    the Dashboard comparison."""
    m = returns.reindex(columns=tickers)
    listed = m.notna().cumsum().gt(0).to_numpy()
    w = np.where(listed, weights, 0.0)
    total = w.sum(axis=1, keepdims=True)
    w = np.divide(w, total, out=np.zeros_like(w), where=total > 0)
    return (m.fillna(0.0).to_numpy() * w).sum(axis=1)


def _portfolio_daily(returns: pd.DataFrame, holdings: list[dict], sleeves: list[dict] | None) -> np.ndarray:
    """Daily-rebalanced index returns; a portfolio of portfolios = Σ allocation x part (Dashboard)."""
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
    """Only the dates on which at least one of `tickers` traded."""
    cols = [t for t in tickers if t in returns.columns]
    return returns[returns[cols].notna().any(axis=1)] if cols else returns.iloc[0:0]


def _growth(returns: pd.DataFrame, tickers: list[str], base: int) -> np.ndarray:
    """(days, tickers) value of 1 put in each stock at row `base`'s close and
    held (NaN = no trade = unchanged; not listed yet = still cash)."""
    raw = returns.reindex(columns=tickers)
    m = raw.fillna(0.0).to_numpy(copy=True)
    m[: base + 1] = 0.0
    # Listed after the start: bought at its FIRST close, so its first row's
    # return (e.g. an IPO-day jump) is not part of what was held.
    for j, col in enumerate(raw.columns):
        first = raw[col].first_valid_index()
        if first is not None:
            f = raw.index.get_loc(first)
            if f > base:
                m[f, j] = 0.0
    return np.cumprod(1.0 + m, axis=0)


def _held_metrics(dates: list[str], value: np.ndarray, base: int) -> dict:
    """Change / volatility / expected return / Sharpe / max drawdown of a held value path from row `base` to the end."""
    v = value[base:]
    out = {"change": None, "volatility": None, "expected_return": None, "sharpe": None, "max_drawdown": None}
    if len(v) < 2 or not v[0]:
        return out
    out["change"] = round(float(v[-1] / v[0] - 1.0), 6)
    drawdown = max_drawdown(v)
    out["max_drawdown"] = None if drawdown is None else round(drawdown, 6)
    daily = v[1:] / v[:-1] - 1.0
    if len(daily) >= 2:
        vol = float(np.std(daily, ddof=1) * np.sqrt(TRADING_DAYS_PER_YEAR))
        exp = float(np.mean(daily) * TRADING_DAYS_PER_YEAR)
        out.update(volatility=round(vol, 6), expected_return=round(exp, 6), sharpe=round(exp / vol, 4) if vol else None)
    return out


def _year_base(dates: list[str], as_of: str) -> int | None:
    cutoff = (pd.Timestamp(as_of) - pd.DateOffset(years=1)).strftime("%Y-%m-%d")
    return next((i for i, d in enumerate(dates) if d >= cutoff), None)


def _metrics(returns: pd.DataFrame, tickers: list[str], weights: list[float], as_of: str) -> dict:
    """1D (rebalanced at the weights) + held 1Y metrics of one weighting, on its own trading days."""
    own = _own_rows(returns, tickers)
    dates = [str(d) for d in own.index]
    w = np.array(weights, dtype=float)
    w = w / w.sum() if w.sum() else w
    out = {"day_change": None, "previous_date": None, "change_1y": None, "volatility_1y": None,
           "expected_return_1y": None, "sharpe_1y": None, "max_drawdown_1y": None, "window_start": None}
    if len(dates) >= 2:
        out["day_change"] = round(float(_index_returns(own.iloc[-1:], tickers, w)[0]), 6)
        out["previous_date"] = dates[-2]
    base = _year_base(dates, as_of)
    if base is not None:
        held = _held_metrics(dates, _growth(own, tickers, base) @ w, base)
        out.update(window_start=dates[base], change_1y=held["change"], volatility_1y=held["volatility"],
                   expected_return_1y=held["expected_return"], sharpe_1y=held["sharpe"],
                   max_drawdown_1y=held["max_drawdown"])
    return out


def analyze_portfolio(holdings: list[dict], sleeves: list[dict] | None = None,
                      lookback_days: int = TRADING_DAYS_PER_YEAR, start: str | None = None) -> dict:
    """Chart series + every number of the portfolio page, all as of one date.

    `series`: the portfolio bought at its weights at the first close on/after
    `start` (default: the start of the history read) and held, starting at 100
    -- the page asks again with the range's first date when the range changes,
    so the chart's % change for any range is a buy-and-hold change too."""
    tickers = [h["ticker"] for h in holdings]
    weights = [h["weight"] for h in holdings]
    returns = _daily_returns(tickers, max(lookback_days, TRADING_DAYS_PER_YEAR + 10))
    as_of = _as_of(returns, tickers) if not returns.empty else None
    if as_of is None:
        return {"as_of": None, "series": [], "summary": None, "holdings": {}, "sleeves": []}
    returns = _own_rows(returns.loc[:as_of], tickers)
    dates = [str(d) for d in returns.index]

    first = max(0, len(dates) - (lookback_days + 1))
    base = next((i for i, d in enumerate(dates) if d >= start), len(dates) - 1) if start else first
    base = max(base, first)
    w = np.array(weights, dtype=float)
    w = w / w.sum()
    value = 100.0 * (_growth(returns, tickers, base) @ w)
    series = [{"date": d, "value": round(float(v), 4)} for d, v in zip(dates[base:], value[base:])]

    summary = _metrics(returns, tickers, weights, as_of)
    per_holding = {}
    for t in tickers:
        m = _metrics(returns, [t], [1.0], as_of)
        first_close = returns[t].first_valid_index() if t in returns.columns else None
        last_close = returns[t].last_valid_index() if t in returns.columns else None
        # Trading for less than the 1Y window: its 1Y is "since listing".
        m["listed_since"] = (str(first_close) if first_close is not None and summary["window_start"]
                             and str(first_close) > summary["window_start"] else None)
        m["last_close"] = str(last_close) if last_close is not None else None
        m["stale"] = bool(last_close is not None and str(last_close) < as_of)
        per_holding[t] = m if first_close is not None else {k: None for k in m}

    parts = [
        {"portfolio_id": s.get("portfolio_id"), "name": s.get("name"),
         **_metrics(returns, [h["ticker"] for h in s["holdings"]],
                    [h.get("weight_in_part", h["weight"]) for h in s["holdings"]], as_of)}
        for s in (sleeves or [])
    ]
    return {"as_of": as_of, "series_start": dates[base], "series": series, "summary": summary,
            "holdings": per_holding, "sleeves": parts}


def live_metrics(portfolios: list[dict]) -> dict:
    """{portfolio key: 1D / held 1Y metrics} for many portfolios with ONE price read (Portfolios list)."""
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
        out[p["_key"]] = {"as_of": as_of, **_metrics(returns.loc[:as_of], ts, [h["weight"] for h in p["holdings"]], as_of)}
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
