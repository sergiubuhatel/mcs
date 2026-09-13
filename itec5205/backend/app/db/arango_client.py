"""ArangoDB connection + schema management.

Both the Flask API and the Celery workers import ``get_db()`` directly
(no Flask application context is required), so the same module works in
either process.
"""

from functools import lru_cache

from arango import ArangoClient

from .. import config

# collection_name -> list of index specs (python-arango add_index() kwargs)
COLLECTIONS = {
    # Normalized sector/industry entities (`_key` = name) so the frontend can
    # search/filter on them directly instead of scanning distinct values off
    # `companies` every time. `industries` links back to its parent sector.
    "sectors": [],
    "industries": [
        {"type": "persistent", "fields": ["sector"], "unique": False},
    ],
    "companies": [
        {"type": "persistent", "fields": ["sector"], "unique": False},
        {"type": "persistent", "fields": ["industry"], "unique": False},
    ],
    "stock_prices": [
        {"type": "persistent", "fields": ["ticker", "date"], "unique": False},
    ],
    "stock_stats": [
        {"type": "persistent", "fields": ["market_cap"], "unique": False},
        {"type": "persistent", "fields": ["trailing_pe"], "unique": False},
        {"type": "persistent", "fields": ["sector"], "unique": False},
    ],
    "financial_ratios": [
        {"type": "persistent", "fields": ["roe"], "unique": False},
        {"type": "persistent", "fields": ["debt_to_equity"], "unique": False},
    ],
    # A named subset of tickers a user saved off a screener search, to use
    # as the candidate universe fed into RL training (search -> pool -> RL).
    "pools": [],
    "portfolios": [],
    "rl_runs": [],
    "price_predictions": [],
}


@lru_cache(maxsize=1)
def _client():
    return ArangoClient(hosts=config.ARANGO_HOST)


@lru_cache(maxsize=1)
def get_db():
    """Return a handle to the app database, creating it on first use."""
    client = _client()
    sys_db = client.db("_system", username=config.ARANGO_USER, password=config.ARANGO_PASSWORD)
    if not sys_db.has_database(config.ARANGO_DB):
        sys_db.create_database(config.ARANGO_DB)
    return client.db(config.ARANGO_DB, username=config.ARANGO_USER, password=config.ARANGO_PASSWORD)


def ensure_collections():
    """Create every collection + index this app needs. Safe to call repeatedly."""
    db = get_db()
    for name, indexes in COLLECTIONS.items():
        if not db.has_collection(name):
            db.create_collection(name)
        collection = db.collection(name)
        for index in indexes:
            collection.add_index(index)
    return db
