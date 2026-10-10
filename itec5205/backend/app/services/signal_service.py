"""Combined evidence per ticker: the Stage 1 "compound signal".

Four independent pieces of evidence ("stars") are lined up for each ticker:

  1. fundamentals -- the ticker still passes the screen its pool was saved from
  2. RL           -- the RL/optimizer allocation holds it (weight > 0)
  3. LSTM         -- the LSTM forecast is up at every horizon (1, 2, 3, 4 months)
  4. ARIMA        -- the ARIMA forecast is up at every horizon

LSTM/ARIMA *agreement* is checked per horizon (both up / both down / disagree)
and overall: the models agree only if they call the same direction at all four
horizons (RQ1). When every available star is positive the signal is "Strong"
("all stars align"); both forecasts agreeing on down at every horizon is "Avoid".
Short-term (next-day/next-week) moves are deliberately not part of the signal.

Everything is computed on read from the stored forecasts/portfolios, so the
board always reflects the latest runs.
"""

import math

from ..db.arango_client import get_db
from .horizons import HORIZONS, horizon_points
from .screening import search_companies

# Horizon moves smaller than this (in %) count as "flat", not a direction --
# otherwise a random-walk ARIMA (exactly 0%) or a +0.001% LSTM drift would
# register as a call.
DIRECTION_DEADBAND_PCT = 0.05

SIGNAL_STRONG = "Strong"
SIGNAL_MIXED = "Mixed"
SIGNAL_WEAK = "Weak"
SIGNAL_AVOID = "Avoid"


def direction(change_pct: float | None, deadband: float = DIRECTION_DEADBAND_PCT) -> str | None:
    if change_pct is None:
        return None
    if change_pct > deadband:
        return "up"
    if change_pct < -deadband:
        return "down"
    return "flat"


def agreement(lstm_dir: str | None, arima_dir: str | None) -> str | None:
    if lstm_dir is None or arima_dir is None:
        return None
    if lstm_dir == arima_dir and lstm_dir in ("up", "down"):
        return f"agree_{lstm_dir}"
    return "disagree"


def horizon_agreement(lstm: dict | None, arima: dict | None) -> dict | None:
    if not lstm or not arima:
        return None
    return {h: agreement(lstm["horizons"][h]["direction"], arima["horizons"][h]["direction"]) for h in HORIZONS}


def _normal_cdf(z: float) -> float:
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


def overall_direction(directions: list[str | None]) -> str | None:
    """"up"/"down" only when every horizon says so; "mixed" otherwise."""
    if not directions or any(d is None for d in directions):
        return None
    if all(d == "up" for d in directions):
        return "up"
    if all(d == "down" for d in directions):
        return "down"
    return "mixed"


def forecast_summary(doc: dict | None) -> dict | None:
    """Per-horizon view of a stored LSTM/ARIMA forecast document, or None when
    there's no forecast or it doesn't reach the 4-month horizon (a forecast made
    before horizons existed -- it needs re-running)."""
    if not doc or not doc.get("forecast"):
        return None
    last = doc.get("last_actual_close")
    points = doc.get("horizons") or horizon_points(doc["forecast"], last)
    if set(points) != set(HORIZONS):
        return None
    horizons = {}
    for label, point in points.items():
        h = {**point, "direction": direction(point["change_pct"])}
        # ARIMA only: probability the close at this horizon ends above the last
        # close, from the 95% interval (half-width = 1.96 standard errors).
        if "lower_95" in point and last:
            se = (point["upper_95"] - point["lower_95"]) / (2 * 1.96)
            h["prob_up"] = round(_normal_cdf((point["predicted_close"] - last) / se), 3) if se > 0 else None
        horizons[label] = h
    return {
        "direction": overall_direction([horizons[h]["direction"] for h in HORIZONS]),
        "horizons": horizons,
        "history_days": doc.get("history_days"),
        "data_end": doc.get("data_end"),
        "trained_at": doc.get("trained_at"),
        "test_rmse": doc.get("test_rmse"),
        "order": doc.get("order"),
        "drift": doc.get("drift"),
    }


def passes_screen(tickers: list[str], screen: dict | None) -> dict[str, bool] | None:
    """Which tickers still pass a saved screener search (None = no screen saved)."""
    if not screen:
        return None
    ranges = {k: (v[0], v[1]) for k, v in (screen.get("ranges") or {}).items()}
    if not (ranges or screen.get("sector") or screen.get("industry") or screen.get("q")):
        return None
    hits = search_companies(
        sector=screen.get("sector") or None,
        industry=screen.get("industry") or None,
        query=screen.get("q") or None,
        ranges=ranges,
        limit=10_000,
    )["results"]
    passing = {row["ticker"] for row in hits}
    return {t: t in passing for t in tickers}


def compound_signal(stars: dict[str, bool | None], agree: str | None) -> str:
    available = [v for v in stars.values() if v is not None]
    positive = sum(1 for v in available if v)
    if agree == "agree_down":
        return SIGNAL_AVOID
    if len(available) >= 3 and positive == len(available):
        return SIGNAL_STRONG
    if positive <= 1:
        return SIGNAL_WEAK
    return SIGNAL_MIXED


def latest_portfolio_for_pool(pool_id: str) -> dict | None:
    db = get_db()
    rows = list(db.aql.execute(
        """
        FOR p IN portfolios
            FILTER p.source_pool_id == @pool_id
            SORT p.created_at DESC
            LIMIT 1
            RETURN p
        """,
        bind_vars={"pool_id": pool_id},
    ))
    return rows[0] if rows else None


def build_signals(tickers: list[str], pool: dict | None = None, portfolio: dict | None = None) -> dict:
    """Signal board rows for `tickers`. `pool` supplies the screen (fundamentals
    star); `portfolio` the RL weights (RL star). Either may be None."""
    db = get_db()
    tickers = [t.upper() for t in tickers]
    names = {
        row["ticker"]: row["name"]
        for row in db.aql.execute(
            "FOR c IN companies FILTER c._key IN @t RETURN {ticker: c._key, name: c.name}", bind_vars={"t": tickers}
        )
    }
    lstm_docs = {d["_key"]: d for d in db.collection("price_predictions").get_many(tickers)}
    arima_docs = {d["_key"]: d for d in db.collection("arima_predictions").get_many(tickers)}
    screen = passes_screen(tickers, (pool or {}).get("filters"))
    weights = {h["ticker"]: h["weight"] for h in (portfolio or {}).get("holdings", [])} if portfolio else None

    rows = []
    for t in tickers:
        lstm = forecast_summary(lstm_docs.get(t))
        arima = forecast_summary(arima_docs.get(t))
        per_horizon = horizon_agreement(lstm, arima)
        # Overall agreement: same direction at all four horizons.
        agree = agreement(lstm and lstm["direction"], arima and arima["direction"])
        stars = {
            "fundamentals": screen.get(t) if screen is not None else None,
            "rl": (weights.get(t, 0) > 0) if weights is not None else None,
            "lstm": (lstm["direction"] == "up") if lstm else None,
            "arima": (arima["direction"] == "up") if arima else None,
        }
        # Forecasts trained on different windows/data aren't comparable.
        mismatch = bool(
            lstm and arima and (lstm["history_days"] != arima["history_days"] or lstm["data_end"] != arima["data_end"])
        )
        rows.append({
            "ticker": t,
            "name": names.get(t),
            "rl_weight": weights.get(t, 0.0) if weights is not None else None,
            "lstm": lstm,
            "arima": arima,
            "agreement": agree,
            "horizon_agreement": per_horizon,
            "horizons_agreeing": sum(1 for v in (per_horizon or {}).values() if v in ("agree_up", "agree_down")),
            "window_mismatch": mismatch,
            "stars": stars,
            "star_count": sum(1 for v in stars.values() if v),
            "stars_available": sum(1 for v in stars.values() if v is not None),
            "signal": compound_signal(stars, agree),
        })

    order = {SIGNAL_STRONG: 0, SIGNAL_MIXED: 1, SIGNAL_WEAK: 2, SIGNAL_AVOID: 3}
    rows.sort(key=lambda r: (order[r["signal"]], -r["star_count"], -(r["rl_weight"] or 0), r["ticker"]))
    summary = {s: sum(1 for r in rows if r["signal"] == s) for s in order}
    summary["agree"] = sum(1 for r in rows if r["agreement"] in ("agree_up", "agree_down"))
    summary["disagree"] = sum(1 for r in rows if r["agreement"] == "disagree")
    summary["missing_forecasts"] = sum(1 for r in rows if r["lstm"] is None or r["arima"] is None)
    return {
        "rows": rows,
        "summary": summary,
        "pool_id": (pool or {}).get("_key"),
        "portfolio_id": (portfolio or {}).get("_key"),
        "portfolio_name": (portfolio or {}).get("name"),
        "has_screen": screen is not None,
        "deadband_pct": DIRECTION_DEADBAND_PCT,
        "horizons": HORIZONS,
    }
