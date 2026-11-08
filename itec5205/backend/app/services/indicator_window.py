"""The time horizon every price-based screening indicator is computed over
(Change, Volatility, Trend R², Line Deviation, Max Drawdown, Up Months, Worst
Month, Trend-Adjusted Return -- the `calculated_stats` collection).

It is the Settings page's Screening Defaults -> "Indicator time horizon"
(`screening.indicator_window_days`, in trading days), 1 year by default. The
stored field names keep their historical `_1y` suffix; `window_days` on each
document says which horizon they were computed over.
"""

from ..db.arango_client import get_db

# Trading days -> short label, the choices offered on the Settings page.
WINDOWS = {63: "3M", 126: "6M", 252: "1Y", 504: "2Y", 756: "3Y", 1260: "5Y"}
DEFAULT_WINDOW_DAYS = 252


def window_from_settings(values: dict | None) -> int:
    """The horizon in a saved settings document's values (default 1 year)."""
    raw = ((values or {}).get("screening") or {}).get("indicator_window_days")
    try:
        days = int(raw)
    except (TypeError, ValueError):
        return DEFAULT_WINDOW_DAYS
    return days if days in WINDOWS else DEFAULT_WINDOW_DAYS


def window_days() -> int:
    """The current horizon, read from the saved settings."""
    db = get_db()
    if not db.has_collection("settings"):
        return DEFAULT_WINDOW_DAYS
    doc = db.collection("settings").get("app") or {}
    return window_from_settings(doc.get("values"))
