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
from .yahoo_import import get_up_to_date_tickers, read_tickers

UNIVERSES = {
    "sp500": {"label": "S&P 500", "file": lambda: config.TICKERS_FILE},
    "russell3000": {"label": "Russell 3000", "file": lambda: config.RUSSELL3000_FILE},
}
DEFAULT_UNIVERSE = "sp500"
EXISTING_MODES = ("skip", "update", "reimport")


def universe_tickers(universe: str) -> list[str]:
    if universe not in UNIVERSES:
        raise ValueError(f"'universe' must be one of {', '.join(UNIVERSES)}")
    return read_tickers(UNIVERSES[universe]["file"]())


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


def tickers_to_import(tickers: list[str], existing: str, import_history: bool) -> list[str]:
    """`tickers` minus the ones `existing` says to leave alone. "update" is
    about price-history gaps, so without history it fetches everything."""
    if existing == "skip":
        have = imported_tickers()
        return [t for t in tickers if t not in have]
    if existing == "update" and import_history:
        current = get_up_to_date_tickers()
        return [t for t in tickers if t not in current]
    return list(tickers)
