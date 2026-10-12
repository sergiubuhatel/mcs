"""Order Calculator: how many shares to buy or sell in each account (e.g. an
RRSP, a LIRA, TFSAs) to reach a target allocation, for a Canadian investor
buying US-listed stocks.

The plan -- shared targets (tickers, target %, USD prices, exchange rate) and
the accounts (cash in CAD, units held) -- is stored as one document, like the
Settings page, so it survives browsers. The math runs in the browser
(`frontend/src/features/orders/orderMath.js`); this module only stores the
plan and supplies live prices (Yahoo, falling back to the stored close) and
the USD/CAD rate.
"""

import json
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import yfinance as yf
from flask import Blueprint, jsonify, request

from ..db.arango_client import get_db

bp = Blueprint("orders", __name__, url_prefix="/api/orders")

COLLECTION = "order_plans"
KEY = "default"
MAX_BYTES = 256 * 1024
FX_SYMBOL = "CAD=X"  # Yahoo: CAD per 1 USD
QUOTE_TTL_SECONDS = 15  # the page refreshes every minute; this absorbs repeats
QUOTE_WORKERS = 8  # Yahoo answers ~1 s per ticker, so fetch in parallel
_quote_cache: dict[str, tuple[float, dict | None]] = {}


def _collection():
    db = get_db()
    if not db.has_collection(COLLECTION):
        db.create_collection(COLLECTION)
    return db.collection(COLLECTION)


@bp.get("/plan")
def get_plan():
    doc = _collection().get(KEY)
    return jsonify({"plan": (doc or {}).get("plan"), "updated_at": (doc or {}).get("updated_at")})


@bp.put("/plan")
def save_plan():
    body = request.get_json(silent=True) or {}
    plan = body.get("plan")
    if not isinstance(plan, dict) or not isinstance(plan.get("targets", []), list) or not isinstance(plan.get("accounts", []), list):
        return jsonify({"error": "plan must be an object with 'targets' and 'accounts' lists"}), 400
    if len(json.dumps(plan)) > MAX_BYTES:
        return jsonify({"error": "plan is too large"}), 400
    doc = {"_key": KEY, "plan": plan, "updated_at": datetime.now(timezone.utc).isoformat()}
    _collection().insert(doc, overwrite=True)
    return jsonify({"plan": plan, "updated_at": doc["updated_at"]})


def _live_quote(ticker: str) -> dict | None:
    """Yahoo's current price (the last close when the market is shut) and the
    previous close, or None when Yahoo has nothing for the ticker."""
    try:
        info = yf.Ticker(ticker).fast_info
        price, previous = info["last_price"], info["previous_close"]
    except Exception:  # noqa: BLE001 - unknown ticker / network: fall back to the stored close
        return None
    if price is None or price != price:  # None or NaN
        return None
    return {"price": round(float(price), 4), "previous_close": round(float(previous), 4) if previous else None}


def _cached_quote(ticker: str) -> dict | None:
    hit = _quote_cache.get(ticker)
    if hit and time.monotonic() - hit[0] < QUOTE_TTL_SECONDS:
        return hit[1]
    quote = _live_quote(ticker)
    _quote_cache[ticker] = (time.monotonic(), quote)
    return quote


@bp.get("/prices")
def prices():
    """Price (USD) per ticker: Yahoo's live price with the change since the
    previous close; the latest stored close when Yahoo has nothing; null when
    neither exists (type the price). Includes the company name."""
    tickers = list(dict.fromkeys(t.strip().upper() for t in (request.args.get("tickers") or "").split(",") if t.strip()))
    if not tickers:
        return jsonify({"prices": {}})
    stored = {
        r["ticker"]: r
        for r in get_db().aql.execute(
            """
            FOR t IN @tickers
                LET p = FIRST(FOR x IN stock_prices FILTER x.ticker == t SORT x.date DESC LIMIT 1 RETURN x)
                LET c = DOCUMENT("companies", t)
                RETURN {ticker: t, close: p.close, date: p.date, name: c.name}
            """,
            bind_vars={"tickers": tickers},
        )
    }
    with ThreadPoolExecutor(max_workers=QUOTE_WORKERS) as pool:
        live = dict(zip(tickers, pool.map(_cached_quote, tickers)))
    now = datetime.now(timezone.utc).isoformat()
    out = {}
    for t in tickers:
        s, q = stored.get(t, {}), live.get(t)
        if q:
            prev = q["previous_close"]
            change = (q["price"] / prev - 1) * 100 if prev else None
            out[t] = {"ticker": t, "name": s.get("name"), "price": q["price"], "previous_close": prev,
                      "change_pct": round(change, 2) if change is not None else None, "source": "live", "as_of": now}
        elif s.get("close") is not None:
            out[t] = {"ticker": t, "name": s.get("name"), "price": s["close"], "previous_close": None,
                      "change_pct": None, "source": "stored", "date": s["date"]}
        else:
            out[t] = {"ticker": t, "name": s.get("name"), "price": None, "source": None}
    return jsonify({"prices": out})


@bp.get("/fx")
def fx():
    """Current USD->CAD rate (CAD for 1 USD) from Yahoo Finance."""
    quote = _cached_quote(FX_SYMBOL)
    if quote is None:
        return jsonify({"error": "Yahoo Finance returned no USD/CAD rate"}), 502
    return jsonify({"usd_cad": round(quote["price"], 4), "as_of": datetime.now(timezone.utc).isoformat()})
