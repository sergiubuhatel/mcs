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
        {"type": "persistent", "fields": ["trend_r2_1y"], "unique": False},
        {"type": "persistent", "fields": ["line_deviation_1y"], "unique": False},
        {"type": "persistent", "fields": ["max_drawdown_1y"], "unique": False},
        {"type": "persistent", "fields": ["up_months_1y"], "unique": False},
        {"type": "persistent", "fields": ["worst_month_1y"], "unique": False},
        {"type": "persistent", "fields": ["trend_return_1y"], "unique": False},
    ],
    # Financial results (services/earnings.py): every earnings release
    # (`_key` = ticker_date) and a per-company last/next summary (`_key` = ticker).
    "earnings_reports": [
        {"type": "persistent", "fields": ["ticker", "date"], "unique": False},
    ],
    # Sales / net income / diluted EPS per quarter and year (`_key` =
    # ticker_freq_periodEnd), accumulated import after import.
    "financial_statements": [
        {"type": "persistent", "fields": ["ticker", "freq", "period_end"], "unique": False},
    ],
    "earnings_dates": [
        {"type": "persistent", "fields": ["next_report_date"], "unique": False},
        {"type": "persistent", "fields": ["last_report_date"], "unique": False},
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
    # Workflows (search -> forecast -> RL, automated): reusable screen /
    # prediction / portfolio criteria (`kind`), the workflows that reference
    # one of each, and each workflow run's step-by-step progress + outcome.
    "criteria": [
        {"type": "persistent", "fields": ["kind", "name"], "unique": False},
    ],
    "workflows": [],
    "workflow_runs": [
        {"type": "persistent", "fields": ["workflow_id", "created_at"], "unique": False},
    ],
    # One document per import job (`_key` = Celery task id), written by the
    # task itself so Market Data page, resumed and workflow imports all appear.
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


_OLD_WORDS = (("Policies", "Workflows"), ("policies", "workflows"), ("Policy", "Workflow"), ("policy", "workflow"))


def _reword(value):
    """Replace the old "policy" wording in every string of a stored document."""
    if isinstance(value, str):
        for old, new in _OLD_WORDS:
            value = value.replace(old, new)
        return value
    if isinstance(value, list):
        return [_reword(v) for v in value]
    if isinstance(value, dict):
        return {k: v if k in ("_key", "_id", "_rev") else _reword(v) for k, v in value.items()}
    return value


def reword_policy_text(db):
    """Rewrite generated names / messages that still say "policy" (run names,
    the pools and portfolios a run created, pool refine reasons)."""
    for name in ("workflows", "workflow_runs", "pools", "portfolios", "criteria", "import_runs"):
        if not db.has_collection(name):
            continue
        col = db.collection(name)
        for doc in db.aql.execute(
            "FOR d IN @@c FILTER CONTAINS(LOWER(TO_STRING(d)), 'polic') RETURN d", bind_vars={"@c": name}
        ):
            new = _reword(doc)
            if new != doc:
                col.replace(new, check_rev=False)


def _migrate_policy_names(db):
    """Workflows used to be called "policies" (renamed 2026-10-18): move the
    old collections and stored field names over once, keeping every document."""
    if not db.has_collection("policies"):
        return
    for old, new in (("policies", "workflows"), ("policy_runs", "workflow_runs")):
        if db.has_collection(old) and not db.has_collection(new):
            db.collection(old).rename(new)
    if db.has_collection("workflow_runs"):
        runs = db.collection("workflow_runs")
        for index in runs.indexes():
            if "policy_id" in index.get("fields", []):
                runs.delete_index(index["id"].split("/")[-1])
        db.aql.execute(
            "FOR r IN workflow_runs FILTER HAS(r, 'policy_id') OR HAS(r, 'policy_name') "
            "UPDATE r WITH {workflow_id: r.policy_id, workflow_name: r.policy_name, "
            "policy_id: null, policy_name: null} IN workflow_runs OPTIONS {keepNull: false}"
        )
    if db.has_collection("import_runs"):
        db.aql.execute("FOR r IN import_runs FILTER r.source == 'policy' UPDATE r WITH {source: 'workflow'} IN import_runs")
    reword_policy_text(db)


def ensure_collections():
    """Create every collection + index this app needs. Safe to call repeatedly."""
    db = get_db()
    _migrate_policy_names(db)
    for name, indexes in COLLECTIONS.items():
        if not db.has_collection(name):
            db.create_collection(name)
        collection = db.collection(name)
        for index in indexes:
            collection.add_index(index)
    return db
