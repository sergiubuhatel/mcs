"""Per-ticker price-history metrics derived from `stock_prices`, shared by
the screener grid and the portfolio detail view."""

import numpy as np
import pandas as pd

from ..db.arango_client import get_db

TRADING_DAYS_PER_YEAR = 252


def _trend(closes: pd.Series) -> tuple[float | None, float | None]:
    """(signed R², max line deviation) of a straight line fit to the close
    against the trading-day number -- the plain price, as the chart shows it
    (a log fit calls an accelerating curve straight). R² is negated when the
    line slopes down (0.95 = smooth climb, -0.95 = smooth slide). R² still
    forgives a flat-then-jump S-shape, so the deviation -- the furthest the
    price strays from the line, as a fraction of the line -- is the direct
    "how straight" test: 0.05 = never more than 5% off it."""
    y = closes.to_numpy(dtype=float)
    if len(y) < 20 or not np.isfinite(y).all() or np.ptp(y) == 0:
        return None, None
    x = np.arange(len(y))
    slope, intercept = np.polyfit(x, y, 1)
    fit = slope * x + intercept
    resid = y - fit
    r2 = 1 - float(resid @ resid) / float(((y - y.mean()) ** 2).sum())
    deviation = float(np.max(np.abs(resid) / np.abs(fit))) if np.all(fit != 0) else None
    return (r2 if slope > 0 else -r2), deviation


def _monthly_changes(recent: pd.DataFrame) -> pd.Series | None:
    """Each calendar month's change in the window, as a fraction (the first
    month is measured from the window's first close, the current month runs
    to the latest close)."""
    s = pd.Series(recent["close"].to_numpy(), index=pd.to_datetime(recent["date"]))
    month_ends = s.resample("ME").last().dropna()
    if len(month_ends) < 2:
        return None
    path = pd.concat([s.iloc[:1], month_ends])
    return path.pct_change().dropna()


def price_history_metrics(tickers: list[str]) -> dict[str, dict]:
    """Per-ticker past-year {growth_1y, volatility_1y, trend_r2_1y,
    line_deviation_1y, max_drawdown_1y, up_months_1y, worst_month_1y, trend_return_1y}, computed in one pass
    over price history. Callers should scope `tickers` to what's actually on
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
            RETURN {ticker: p.ticker, date: p.date, close: p.close, percentage_change: p.percentage_change}
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
        closes = recent["close"]

        first, last = closes.iloc[0], closes.iloc[-1]
        growth = round(float(last / first - 1), 4) if len(recent) >= 2 and first else None

        pct = recent["percentage_change"].dropna() / 100.0
        volatility = round(float(pct.std() * (TRADING_DAYS_PER_YEAR**0.5)), 4) if len(pct) >= 2 else None

        r2, deviation = _trend(closes)
        drawdown = float(-(closes / closes.cummax() - 1).min()) if len(closes) >= 2 else None
        months = _monthly_changes(recent)

        metrics[ticker] = {
            "growth_1y": growth,
            "volatility_1y": volatility,
            "trend_r2_1y": None if r2 is None else round(r2, 4),
            "line_deviation_1y": None if deviation is None else round(deviation, 4),
            "max_drawdown_1y": None if drawdown is None else round(drawdown, 4),
            "up_months_1y": None if months is None else int((months > 0).sum()),
            # The worst month: >= 0 means it rose every month, >= 0.02 at
            # least 2% every month.
            "worst_month_1y": None if months is None else round(float(months.min()), 4),
            # Return discounted by how far the path strays from a straight
            # line: 30% at R² 0.98 (29.4%) outranks 40% at R² 0.50 (20%).
            "trend_return_1y": None if growth is None or r2 is None else round(growth * abs(r2), 4),
        }
    return metrics
