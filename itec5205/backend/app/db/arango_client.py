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
        {"type": "persistent", "fields": ["roe_ttm"], "unique": False},
        {"type": "persistent", "fields": ["debt_to_equity_mrq"], "unique": False},
    ],
    # Metrics derived from `stock_prices` (not sourced from Yahoo's `info`
    # like `stock_stats`) -- computed once per ticker at import time and
    # kept separate so the raw-vs-derived distinction stays obvious. `_key`
    # is the ticker, same join pattern as `stock_stats`.
    "calculated_stats": [
        {"type": "persistent", "fields": ["stock_growth_1y"], "unique": False},
        {"type": "persistent", "fields": ["volatility_1y"], "unique": False},
    ],
    # A named subset of tickers a user saved off a screener search, to use
    # as the candidate universe fed into RL training (search -> pool -> RL).
    "pools": [
        {"type": "persistent", "fields": ["root_pool_id"], "unique": False},
    ],
    "portfolios": [
        {"type": "persistent", "fields": ["source_pool_id", "created_at"], "unique": False},
    ],
    "rl_runs": [],
    "price_predictions": [],
    "arima_predictions": [],
    # Batch LSTM+ARIMA jobs over a pool/portfolio (task ids + timing, RQ5).
    "forecast_runs": [
        {"type": "persistent", "fields": ["pool_id", "created_at"], "unique": False},
        {"type": "persistent", "fields": ["portfolio_id", "created_at"], "unique": False},
    ],
    # Policies (search -> forecast -> RL, automated): reusable screen /
    # prediction / portfolio criteria (`kind`), the policies that reference
    # one of each, and each policy run's step-by-step progress + outcome.
    "criteria": [
        {"type": "persistent", "fields": ["kind", "name"], "unique": False},
    ],
    "policies": [],
    "policy_runs": [
        {"type": "persistent", "fields": ["policy_id", "created_at"], "unique": False},
    ],
    # One document per import job (`_key` = Celery task id), written by the
    # task itself so Market Data page, resumed and policy imports all appear.
    "import_runs": [
        {"type": "persistent", "fields": ["created_at"], "unique": False},
    ],
    # Companies an import found delisted and removed (`_key` = ticker);
    # whole-list imports leave them out (services/delisting.py).
    "delisted_tickers": [],
    # App-wide initial values (Settings page): one document, `_key` "app".
    "settings": [],
    # Order Calculator plan (targets + accounts): one document, `_key` "default".
    "order_plans": [],
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
