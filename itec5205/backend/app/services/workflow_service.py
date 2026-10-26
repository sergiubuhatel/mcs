"""Workflows: a named, re-runnable recipe that automates search -> forecast ->
RL portfolio.

A workflow references four reusable criteria documents (collection
`criteria`, field `kind`), run in this order:

  data        -- optional: the Yahoo Finance import to run first (which
                 tickers, how many years of history, what to import, only
                 what's missing); without it the run uses the stored data
  screen      -- the Fundamental Analysis search (sector/industry/q/ranges)
  prediction  -- optional: forecast horizons (e.g. 3 days, 1 month), the
                 training window (business days, or months/years of them),
                 which models must forecast the move, and the minimum move;
                 without it every screened company goes to the portfolio step
  portfolio   -- the RL training options (mode, limits, company counts, ...)

Running a workflow is `tasks.workflow_tasks.run_workflow`; this module holds the
CRUD, payload normalization, and the pure helpers that task uses.
"""

import uuid
from datetime import date, datetime, timezone

from ..db.arango_client import get_db
from .rl_service import WEIGHT_RANGE_BASES
from .universes import INDEXES, existing_mode, normalize_universe

KINDS = ("data", "screen", "prediction", "portfolio")
OPTIONAL_KINDS = ("data", "prediction")

# Trading days per unit (21 per month, matching horizons.py).
HORIZON_UNITS = {"days": 1, "weeks": 5, "months": 21, "years": 252}
TRAINING_UNITS = ("days", "months", "years")
MODEL_RULES = ("both", "either", "lstm", "arima")
PORTFOLIO_MODES = ("full", "subset")
IMPORT_YEARS = (1, 2, 5, 10, 15, 20)  # the Data page's "Since" choices
MIN_TRAINING_DAYS = 120  # = lstm_service.MIN_HISTORY_DAYS


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _num(value, cast=float, minimum=None, maximum=None, field="value"):
    """None for blank; otherwise `cast(value)`, range-checked."""
    if value in (None, ""):
        return None
    try:
        out = cast(value)
    except (TypeError, ValueError):
        raise ValueError(f"'{field}' must be a number")
    if minimum is not None and out < minimum:
        raise ValueError(f"'{field}' must be at least {minimum}")
    if maximum is not None and out > maximum:
        raise ValueError(f"'{field}' must be at most {maximum}")
    return out


# --------------------------------------------------------------- normalizers

def _normalize_data(body: dict) -> dict:
    """Same options as the Data page's import form."""
    scope = body.get("scope", "all")
    if scope not in ("all", "specific"):
        raise ValueError("'scope' must be 'all' or 'specific'")
    universe = normalize_universe(body.get("universe"))
    tickers = body.get("tickers") or []
    if isinstance(tickers, str):
        tickers = tickers.split(",")
    tickers = list(dict.fromkeys(t.strip().upper() for t in tickers if t and t.strip()))
    if scope == "specific" and not tickers:
        raise ValueError("List the tickers to import")
    years = _num(body.get("years"), int, field="years") or 10
    if years not in IMPORT_YEARS:
        raise ValueError(f"'years' must be one of {', '.join(map(str, IMPORT_YEARS))}")
    flags = {k: bool(body.get(k, True)) for k in ("import_history", "import_statistics", "import_calculated_stats")}
    flags["import_earnings"] = bool(body.get("import_earnings", False))  # added later: off for older criteria
    if not any(flags.values()):
        raise ValueError("Pick at least one of history, statistics, calculated statistics, financial results")
    existing = existing_mode(body)
    return {
        "scope": scope,
        "universe": universe if scope == "all" else None,
        "tickers": tickers if scope == "specific" else [],
        "years": years,
        # What to do with companies already in the database (services/universes.py).
        "existing": existing,
        "only_missing": existing == "update",  # kept for older readers
        **flags,
    }


def _normalize_screen(body: dict) -> dict:
    """`filters` is the screener form state (UI units, used to re-open the
    editor); `screen` is the same search in API units (what runs)."""
    screen = body.get("screen") or {}
    ranges = {}
    for key, bounds in (screen.get("ranges") or {}).items():
        lo, hi = (list(bounds) + [None, None])[:2]
        lo, hi = _num(lo, field=f"{key} min"), _num(hi, field=f"{key} max")
        if lo is not None or hi is not None:
            ranges[key] = [lo, hi]
    index = screen.get("index") or ""
    if index and index not in INDEXES:
        raise ValueError(f"'index' must be one of {', '.join(INDEXES)}")
    return {
        "filters": body.get("filters") or {},
        "screen": {
            "index": index,
            "sector": screen.get("sector") or "",
            "industry": screen.get("industry") or "",
            "q": (screen.get("q") or "").strip(),
            "ranges": ranges,
        },
    }


def _normalize_prediction(body: dict) -> dict:
    horizons = []
    for h in body.get("horizons") or []:
        unit = h.get("unit", "months")
        if unit not in HORIZON_UNITS:
            raise ValueError(f"Unknown horizon unit '{unit}'")
        value = _num(h.get("value"), int, 1, field="horizon")
        if value is None:
            continue
        horizons.append({"value": value, "unit": unit})
    if not horizons:
        raise ValueError("Add at least one prediction point (e.g. 1 month)")
    # Sorted and de-duplicated by trading days (5 days == 1 week).
    by_days = {horizon_days(h): h for h in horizons}
    horizons = [by_days[d] for d in sorted(by_days)]

    training = body.get("training") or {}
    t_unit = training.get("unit", "years")
    if t_unit not in TRAINING_UNITS:
        raise ValueError(f"Unknown training unit '{t_unit}'")
    t_value = _num(training.get("value"), int, 1, field="training") or 10
    if t_unit == "days" and t_value < MIN_TRAINING_DAYS:
        raise ValueError(f"Training needs at least {MIN_TRAINING_DAYS} days")

    rule = body.get("models", "both")
    if rule not in MODEL_RULES:
        raise ValueError(f"'models' must be one of {', '.join(MODEL_RULES)}")
    return {
        "horizons": horizons,
        "training": {"value": t_value, "unit": t_unit},
        "models": rule,
        "min_change_pct": _num(body.get("min_change_pct"), field="min change"),
        "epochs": _num(body.get("epochs"), int, 1, 1000, field="epochs") or 100,
        "reuse_forecasts": bool(body.get("reuse_forecasts", True)),
    }


def _normalize_portfolio(body: dict) -> dict:
    mode = body.get("mode", "full")
    if mode not in PORTFOLIO_MODES:
        raise ValueError(f"'mode' must be one of {', '.join(PORTFOLIO_MODES)}")
    min_c = _num(body.get("min_companies"), int, 2, field="min companies")
    max_c = _num(body.get("max_companies"), int, 2, field="max companies")
    if min_c is not None and max_c is not None and min_c > max_c:
        raise ValueError("Min companies can't be greater than max companies")
    risk_aversion = _num(body.get("risk_aversion"), float, 0, field="risk aversion")
    basis = body.get("weight_range_basis") or "smallest"
    if basis not in WEIGHT_RANGE_BASES:
        raise ValueError(f"'weight_range_basis' must be one of {', '.join(WEIGHT_RANGE_BASES)}")
    required, excluded = _tickers(body.get("required_tickers")), _tickers(body.get("excluded_tickers"))
    both = [t for t in required if t in set(excluded)]
    if both:
        raise ValueError(f"{', '.join(both)} can't be both mandatory and excluded")
    return {
        "mode": mode,
        "trend_window_days": _num(body.get("trend_window_days"), int, 21, field="trend window") or 252,
        "risk_aversion": 1.0 if risk_aversion is None else risk_aversion,
        "timesteps": _num(body.get("timesteps"), int, 1000, field="timesteps") or 20_000,
        "max_volatility_pct": _num(body.get("max_volatility_pct"), float, 0, field="max volatility"),
        "min_return_pct": _num(body.get("min_return_pct"), field="min annual return"),
        # Optional cap on max(weight) - min(weight), in % of the smallest /
        # largest holding or in percentage points (`weight_range_basis`).
        "max_weight_range_pct": _num(
            body.get("max_weight_range_pct"), float, 0, None if basis == "smallest" else 100, field="max weight range"
        ),
        "weight_range_basis": basis,
        "min_companies": min_c,
        "max_companies": max_c,
        # Must be in the portfolio -- when they reach this step (a company
        # dropped by the screen or the forecast filter is ignored).
        "required_tickers": required,
        # Never in the portfolio, even when they pass every earlier step.
        "excluded_tickers": excluded,
    }


def _tickers(value) -> list[str]:
    """A ticker list from a list or a comma/space separated string, upper-cased, de-duplicated."""
    if isinstance(value, str):
        value = value.replace(",", " ").split()
    return list(dict.fromkeys(str(t).strip().upper() for t in value or [] if str(t).strip()))


NORMALIZERS = {"data": _normalize_data, "screen": _normalize_screen, "prediction": _normalize_prediction, "portfolio": _normalize_portfolio}


# ------------------------------------------------------------------- criteria

def list_criteria(kind: str) -> list[dict]:
    return list(get_db().aql.execute(
        "FOR c IN criteria FILTER c.kind == @kind SORT c.name RETURN c", bind_vars={"kind": kind}
    ))


def get_criteria(kind: str, criteria_id: str) -> dict | None:
    col = get_db().collection("criteria")
    doc = col.get(criteria_id) if criteria_id and col.has(criteria_id) else None
    return doc if doc and doc.get("kind") == kind else None


def create_criteria(kind: str, body: dict) -> dict:
    name = (body.get("name") or "").strip()
    if not name:
        raise ValueError("'name' is required")
    now = _now()
    doc = {
        "_key": str(uuid.uuid4()),
        "kind": kind,
        "name": name,
        "description": (body.get("description") or "").strip(),
        **NORMALIZERS[kind](body),
        "created_at": now,
        "updated_at": now,
    }
    get_db().collection("criteria").insert(doc)
    return doc


def update_criteria(kind: str, criteria_id: str, body: dict) -> dict | None:
    current = get_criteria(kind, criteria_id)
    if current is None:
        return None
    merged = {**current, **body}
    name = (merged.get("name") or "").strip()
    if not name:
        raise ValueError("'name' is required")
    doc = {
        **current,
        "name": name,
        "description": (merged.get("description") or "").strip(),
        **NORMALIZERS[kind](merged),
        "updated_at": _now(),
    }
    get_db().collection("criteria").replace(doc)
    return get_criteria(kind, criteria_id)


def set_default_criteria(kind: str, criteria_id: str, is_default: bool = True) -> dict | None:
    """At most one default per kind: new workflows start with it selected."""
    if get_criteria(kind, criteria_id) is None:
        return None
    db = get_db()
    if is_default:
        db.aql.execute(
            "FOR c IN criteria FILTER c.kind == @kind AND c.is_default == true UPDATE c WITH {is_default: false} IN criteria",
            bind_vars={"kind": kind},
        )
    db.collection("criteria").update({"_key": criteria_id, "is_default": bool(is_default)})
    return get_criteria(kind, criteria_id)


def duplicate_criteria(kind: str, criteria_id: str) -> dict | None:
    current = get_criteria(kind, criteria_id)
    if current is None:
        return None
    return create_criteria(kind, {**current, "name": f"{current['name']} (copy)"})  # create_criteria drops is_default


def workflows_using(kind: str, criteria_id: str) -> list[dict]:
    return list(get_db().aql.execute(
        f"FOR p IN workflows FILTER p.{kind}_criteria_id == @id RETURN {{_key: p._key, name: p.name}}",
        bind_vars={"id": criteria_id},
    ))


def delete_criteria(kind: str, criteria_id: str) -> bool:
    """Raises ValueError while a workflow still references it."""
    if get_criteria(kind, criteria_id) is None:
        return False
    users = workflows_using(kind, criteria_id)
    if users:
        raise ValueError("Used by workflow " + ", ".join(f"'{p['name']}'" for p in users) + " -- change or delete it first")
    get_db().collection("criteria").delete(criteria_id)
    return True


# ------------------------------------------------------------------- workflows

def _normalize_workflow(body: dict) -> dict:
    name = (body.get("name") or "").strip()
    if not name:
        raise ValueError("'name' is required")
    refs = {}
    for kind in KINDS:
        field = f"{kind}_criteria_id"
        if kind in OPTIONAL_KINDS and not body.get(field):
            refs[field] = None
            continue
        if get_criteria(kind, body.get(field)) is None:
            raise ValueError(f"Pick a {kind} criteria")
        refs[field] = body[field]
    return {"name": name, "description": (body.get("description") or "").strip(), **refs}


def _with_last_run(workflows: list[dict]) -> list[dict]:
    if not workflows:
        return []
    runs = {
        r["workflow_id"]: r
        for r in get_db().aql.execute(
            """
            FOR r IN workflow_runs
                FILTER r.workflow_id IN @ids
                COLLECT pid = r.workflow_id INTO g
                LET last = FIRST(FOR x IN g[*].r SORT x.created_at DESC LIMIT 1 RETURN x)
                RETURN last
            """,
            bind_vars={"ids": [p["_key"] for p in workflows]},
        )
    }
    return [{**p, "last_run": runs.get(p["_key"])} for p in workflows]


def list_workflows() -> list[dict]:
    return _with_last_run(list(get_db().aql.execute("FOR p IN workflows SORT p.created_at DESC RETURN p")))


def get_workflow(workflow_id: str) -> dict | None:
    col = get_db().collection("workflows")
    return col.get(workflow_id) if workflow_id and col.has(workflow_id) else None


def create_workflow(body: dict) -> dict:
    now = _now()
    doc = {"_key": str(uuid.uuid4()), **_normalize_workflow(body), "created_at": now, "updated_at": now}
    get_db().collection("workflows").insert(doc)
    return _with_last_run([doc])[0]


def update_workflow(workflow_id: str, body: dict) -> dict | None:
    current = get_workflow(workflow_id)
    if current is None:
        return None
    doc = {**current, **_normalize_workflow({**current, **body}), "updated_at": _now()}
    get_db().collection("workflows").replace(doc)
    return _with_last_run([get_workflow(workflow_id)])[0]


def duplicate_workflow(workflow_id: str) -> dict | None:
    current = get_workflow(workflow_id)
    if current is None:
        return None
    return create_workflow({**current, "name": f"{current['name']} (copy)"})


def delete_workflow(workflow_id: str) -> bool:
    """Deletes the workflow and its run history; the pools and portfolios its
    runs created are kept."""
    db = get_db()
    if get_workflow(workflow_id) is None:
        return False
    db.aql.execute("FOR r IN workflow_runs FILTER r.workflow_id == @id REMOVE r IN workflow_runs", bind_vars={"id": workflow_id})
    db.collection("workflows").delete(workflow_id)
    return True


def list_runs(workflow_id: str, limit: int = 20) -> list[dict]:
    return list(get_db().aql.execute(
        "FOR r IN workflow_runs FILTER r.workflow_id == @id SORT r.created_at DESC LIMIT @n RETURN r",
        bind_vars={"id": workflow_id, "n": limit},
    ))


# -------------------------------------------------------------- run helpers

def horizon_days(h: dict) -> int:
    return h["value"] * HORIZON_UNITS[h["unit"]]


def horizon_label(h: dict) -> str:
    unit = h["unit"][:-1] if h["value"] == 1 else h["unit"]
    return f"{h['value']} {unit}"


def _months_back(day: date, months: int) -> date:
    """Calendar arithmetic (like the frontend's dateRanges.js), clamped to
    the end of a shorter month."""
    total = day.year * 12 + day.month - 1 - months
    year, month = divmod(total, 12)
    month += 1
    for d in (day.day, 30, 29, 28):
        try:
            return date(year, month, d)
        except ValueError:
            continue
    raise ValueError("bad date")


def training_start(training: dict, today: date | None = None) -> str | None:
    """ISO start date for a months/years window; None for a plain day count."""
    today = today or date.today()
    if training["unit"] == "days":
        return None
    months = training["value"] * (12 if training["unit"] == "years" else 1)
    return _months_back(today, months).isoformat()


def history_stats(tickers: list[str], start: str | None) -> dict[str, dict]:
    """{ticker: {total, since, last}}: stored closes overall / since `start`,
    and the latest stored date -- one pass over the [ticker, date] index."""
    rows = get_db().aql.execute(
        """
        FOR p IN stock_prices
            FILTER p.ticker IN @tickers
            COLLECT t = p.ticker AGGREGATE total = COUNT(1), since = SUM(@start == null || p.date >= @start ? 1 : 0), last = MAX(p.date)
            RETURN {t, total, since, last}
        """,
        bind_vars={"tickers": tickers, "start": start},
    )
    return {r["t"]: {"total": r["total"], "since": r["since"], "last": r["last"]} for r in rows}


def lookback_for(training: dict, stats: dict) -> int:
    """Training closes for one ticker: the business days in the window (the
    exact count stored since the start date for months/years)."""
    return training["value"] if training["unit"] == "days" else max(stats["since"], 1)


def forecast_reusable(doc: dict | None, lookback: int, stats: dict, forecast_days: int, epochs: int | None) -> bool:
    """A stored forecast already trained on exactly this window of the
    current data, long enough, and (LSTM) with the same max epochs."""
    if not doc or not doc.get("forecast"):
        return False
    return (
        doc.get("history_days") == min(lookback, stats["total"])
        and doc.get("data_end") == stats["last"]
        and len(doc["forecast"]) >= forecast_days
        and (epochs is None or doc.get("epochs") == epochs)
    )


def evaluate_forecasts(tickers: list[str], criteria: dict) -> list[dict]:
    """Per ticker: the forecast change at every horizon for each model, and
    whether it passes. A model "says up" at a horizon when its change from
    the last close is >= min_change_pct (or > 0.05% when not set, the signal
    board's dead band). `models` = which must say up at every horizon."""
    from .signal_service import DIRECTION_DEADBAND_PCT

    db = get_db()
    docs = {
        "lstm": {d["_key"]: d for d in db.collection("price_predictions").get_many(tickers)},
        "arima": {d["_key"]: d for d in db.collection("arima_predictions").get_many(tickers)},
    }
    needed = models_needed(criteria["models"])
    min_change = criteria.get("min_change_pct")
    rows = []
    for t in tickers:
        row = {"ticker": t, "models": {}, "reason": None}
        model_ok = {}
        for model in needed:
            doc = docs[model].get(t)
            if not doc or not doc.get("forecast") or not doc.get("last_actual_close"):
                row["models"][model] = None
                model_ok[model] = False
                continue
            last = doc["last_actual_close"]
            changes = {}
            for h in criteria["horizons"]:
                days = horizon_days(h)
                if len(doc["forecast"]) < days:
                    changes[horizon_label(h)] = None
                    continue
                changes[horizon_label(h)] = round((doc["forecast"][days - 1]["predicted_close"] / last - 1) * 100, 3)
            ups = [
                c is not None and (c >= min_change if min_change is not None else c > DIRECTION_DEADBAND_PCT)
                for c in changes.values()
            ]
            row["models"][model] = {"changes": changes, "up_everywhere": all(ups)}
            model_ok[model] = all(ups)

        rule = criteria["models"]
        passed = any(model_ok.values()) if rule == "either" else all(model_ok.values())
        row["passed"] = passed
        if not passed:
            missing = [m for m in needed if row["models"].get(m) is None]
            row["reason"] = f"no {'/'.join(missing).upper()} forecast" if missing else "forecast not up at every point"
        rows.append(row)
    return rows


def models_needed(rule: str) -> tuple[str, ...]:
    return ("lstm", "arima") if rule in ("both", "either") else (rule,)
