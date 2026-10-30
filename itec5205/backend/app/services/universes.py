"""The ticker lists an import can cover, and which of their companies an
import should actually fetch.

`scope` "all" means a whole index (`universe`), "specific" a typed list.
`existing` decides what happens to companies already in the database:
  - "skip":     never import them again; only new companies are fetched
  - "update":   catch them up only if their prices are behind the last
                trading day (the old "only import what's missing")
  - "reimport": fetch everything requested
"""

from .. import config
from ..db.arango_client import get_db
from .delisting import delisted_tickers
from .yahoo_import import _last_closed_session_date, get_up_to_date_tickers, read_tickers

# Index ticker lists (also the screener's Index filter).
INDEXES = {
    "sp500": {"label": "S&P 500", "file": lambda: config.TICKERS_FILE},
    "russell3000": {"label": "Russell 3000", "file": lambda: config.RUSSELL3000_FILE},
}
# What a whole-list import can cover: "all" = every index plus any other
# company already in the database (the default), or a single index.
UNIVERSES = {"all": {"label": "All"}, **INDEXES}
# "imported" (every company already in the database) was folded into "all";
# older criteria and import runs still carry it.
UNIVERSE_ALIASES = {"imported": "all"}
DEFAULT_UNIVERSE = "all"
# Most rows one request may ask for ("all results"): above any index size.
MAX_RESULTS = 5000
EXISTING_MODES = ("skip", "update", "reimport")
# Market benchmarks (Dashboard: a portfolio against the S&P 500 and the Dow):
# every import that fetches prices also catches these up when they are behind,
# for the same years, whatever was asked. DIA (the Dow Jones ETF) stands for
# the Dow: Yahoo's "DOW" is Dow Inc., and the ^DJI index can't be an
# ArangoDB key.
BENCHMARKS = ("SPY", "DIA")


def normalize_universe(universe: str | None) -> str:
    universe = UNIVERSE_ALIASES.get(universe, universe) or DEFAULT_UNIVERSE
    if universe not in UNIVERSES:
        raise ValueError(f"'universe' must be one of {', '.join(UNIVERSES)}")
    return universe


def universe_tickers(universe: str) -> list[str]:
    """The list's tickers minus companies found delisted (services/delisting.py)."""
    universe = normalize_universe(universe)
    if universe == "all":
        tickers = imported_tickers()
        for index in INDEXES.values():
            tickers.update(read_tickers(index["file"]()))
    else:
        tickers = read_tickers(UNIVERSES[universe]["file"]())
    gone = delisted_tickers()
    return sorted(t for t in tickers if t not in gone) if universe == "all" else [t for t in tickers if t not in gone]


def existing_mode(body: dict) -> str:
    """`existing` from a request/criteria; older ones only have `only_missing`."""
    mode = body.get("existing")
    if mode is None:
        return "update" if body.get("only_missing", True) else "reimport"
    if mode not in EXISTING_MODES:
        raise ValueError(f"'existing' must be one of {', '.join(EXISTING_MODES)}")
    return mode


def imported_tickers() -> set[str]:
    """Companies already in the database (every import writes one)."""
    return set(get_db().aql.execute("FOR c IN companies RETURN c._key"))


def tickers_to_import(tickers: list[str], existing: str, import_history: bool) -> tuple[list[str], str]:
    """`tickers` minus the ones `existing` says to leave alone, and the mode
    actually used, plus any BENCHMARKS whose prices are behind."""
    chosen, existing = _requested_to_import(tickers, existing, import_history)
    if import_history:
        chosen += [b for b in _behind(BENCHMARKS) if b not in chosen]
    return chosen, existing


def _behind(tickers) -> list[str]:
    """Those whose prices stop before the last closed session (indexed
    per-ticker lookups, not get_up_to_date_tickers' scan of every price)."""
    cutoff = _last_closed_session_date().isoformat()
    latest = get_db().aql.execute(
        "FOR t IN @tickers RETURN {t, d: FIRST(FOR p IN stock_prices FILTER p.ticker == t "
        "SORT p.date DESC LIMIT 1 RETURN p.date)}",
        bind_vars={"tickers": list(tickers)},
    )
    return [row["t"] for row in latest if (row["d"] or "") < cutoff]


def _requested_to_import(tickers: list[str], existing: str, import_history: bool) -> tuple[list[str], str]:
    """"update" is about price-history gaps, so without history it fetches
    everything. "skip" with no new company left falls back to "update"
    (the user's rule: an import that would do nothing catches up instead)."""
    if existing == "skip":
        have = imported_tickers()
        new = [t for t in tickers if t not in have]
        if new:
            return new, "skip"
        existing = "update"
    if existing == "update" and import_history:
        current = get_up_to_date_tickers()
        return [t for t in tickers if t not in current], existing
    return list(tickers), existing
