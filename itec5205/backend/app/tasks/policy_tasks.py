"""Background job: run a policy end to end -- import -> screen -> forecast ->
RL portfolio.

The orchestrator runs on its own `policy` queue and fans the heavy work out
to the existing workers: the import on the `import` queue, one LSTM/ARIMA
task per ticker on the `lstm` / `arima` queues (in parallel), then one RL
task on the `rl` queue. It waits
on them by polling their states (never `.get()` inside a task), and records
step-by-step progress in the run's `policy_runs` document, which the UI
polls. Stop uses the same Redis stop-flag as the import job.
"""

import time
from datetime import date, datetime, timezone

from celery.result import AsyncResult

from .. import config
from ..db.arango_client import get_db
from ..services.horizons import MAX_HORIZON_DAYS
from ..services.lstm_service import MIN_HISTORY_DAYS
from ..services.policy_service import (
    evaluate_forecasts,
    forecast_reusable,
    history_stats,
    horizon_days,
    lookback_for,
    models_needed,
    training_start,
)
from ..services.pool_service import create_pool, refine_pool
from ..services.screening import search_companies
from ..services.yahoo_import import get_up_to_date_tickers, read_tickers
from .arima_tasks import train_arima_prediction
from .celery_app import celery_app
from .import_tasks import import_sp500_data
from .predict_tasks import train_lstm_prediction
from .rl_tasks import train_rl_portfolio
from .stop_flags import clear_stop, is_stop_requested, request_stop

POLL_SECONDS = 2
DONE_STATES = {"SUCCESS", "FAILURE", "REVOKED"}
# Overall progress bar: share of 100% each step covers.
STEP_SPAN = {"data": (0, 25), "screen": (25, 28), "forecast": (28, 75), "portfolio": (75, 100)}
STEP_INDEX = {"data": 1, "screen": 2, "forecast": 3, "portfolio": 4}


class Cancelled(Exception):
    pass


class PolicyRunError(Exception):
    pass


def _snapshot(task_id):
    """(state, payload) of a child task from ONE result-backend read. Reading
    ``res.state`` and then ``res.info`` fetches twice, so a task finishing in
    between pairs a PROGRESS state with the final result dict (which has no
    "completed") -> KeyError: 'completed'."""
    meta = celery_app.backend.get_task_meta(task_id)
    return meta.get("status"), meta.get("result")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _pct(step: str, fraction: float) -> int:
    lo, hi = STEP_SPAN[step]
    return int(round(lo + (hi - lo) * max(0.0, min(1.0, fraction))))


@celery_app.task(bind=True, name="run_policy")
def run_policy(self, run_id: str):
    col = get_db().collection("policy_runs")
    run = col.get(run_id)
    started = datetime.now(timezone.utc)
    children: list[str] = []  # child task ids, revoked on cancel

    def save(**patch):
        col.update({"_key": run_id, **patch})
        run.update(patch)

    def check_stop():
        if is_stop_requested(self.request.id):
            raise Cancelled()

    def step(name: str, fraction: float, message: str, **detail):
        steps = {**run.get("steps", {}), name: {**run.get("steps", {}).get(name, {}), **detail}}
        save(step=name, step_index=STEP_INDEX[name], percent=_pct(name, fraction), message=message, steps=steps)

    try:
        save(status="running", started_at=started.isoformat())
        today = date.today().isoformat()
        name = run["policy_name"]
        data_c = run["criteria"]["data"]
        screen_c = run["criteria"]["screen"]
        pred_c = run["criteria"]["prediction"]
        port_c = run["criteria"]["portfolio"]

        # ---- 1. data (import) -------------------------------------------
        if data_c is None:
            step("data", 1, "No data criteria -- using the data already stored", status="skipped")
        else:
            step("data", 0, "Checking what needs importing...", status="running")
            wanted = data_c["tickers"] if data_c["scope"] == "specific" else read_tickers(config.TICKERS_FILE)
            to_import = wanted
            if data_c["only_missing"] and data_c["import_history"]:
                up_to_date = get_up_to_date_tickers()
                to_import = [t for t in wanted if t not in up_to_date]
            skipped = len(wanted) - len(to_import)
            if not to_import:
                step("data", 1, "Data already up to date", status="done", requested=len(wanted), up_to_date=skipped, imported=0, failed=0)
            else:
                imp = import_sp500_data.delay(
                    tickers=to_import, years=data_c["years"], import_history=data_c["import_history"],
                    import_statistics=data_c["import_statistics"], import_calculated_stats=data_c["import_calculated_stats"],
                    scope=data_c["scope"], source="policy",
                )
                children.append(imp.id)
                while True:
                    state, payload = _snapshot(imp.id)
                    if state == "SUCCESS":
                        break
                    if state in ("FAILURE", "REVOKED"):
                        raise PolicyRunError(f"Import failed: {payload}")
                    info = payload if state == "PROGRESS" and isinstance(payload, dict) else {}
                    if info.get("total") and "completed" in info:
                        step("data", info["completed"] / info["total"],
                             f"Importing · {info['completed']}/{info['total']} ({info.get('ticker', '')})",
                             requested=len(wanted), up_to_date=skipped, completed=info["completed"], total=info["total"])
                    else:
                        step("data", 0, f"Waiting for the import worker · {len(to_import)} companies to import",
                             requested=len(wanted), up_to_date=skipped, completed=0, total=len(to_import))
                    check_stop()
                    time.sleep(POLL_SECONDS)
                r = payload
                if r.get("stopped"):
                    raise PolicyRunError("The import was stopped")
                step(
                    "data", 1, f"Imported {r['succeeded_count']} companies" + (f", {r['failed_count']} failed" if r["failed_count"] else ""),
                    status="done", requested=len(wanted), up_to_date=skipped, imported=r["succeeded_count"],
                    failed=r["failed_count"], completed=r["total"], total=r["total"],
                )
        check_stop()

        # ---- 2. screen -------------------------------------------------
        step("screen", 0, "Searching companies with the screen criteria...", status="running")
        s = screen_c["screen"]
        hits = search_companies(
            sector=s.get("sector") or None,
            industry=s.get("industry") or None,
            query=s.get("q") or None,
            ranges={k: (v[0], v[1]) for k, v in (s.get("ranges") or {}).items()},
            limit=10_000,
        )["results"]
        tickers = [h["ticker"] for h in hits]
        if len(tickers) < 2:
            raise PolicyRunError(f"The screen criteria matched {len(tickers)} companies -- need at least 2")
        pool = create_pool(name=f"{name} · {today}", tickers=tickers, filters=s)
        step("screen", 1, f"{len(tickers)} companies match the screen", status="done", tickers=len(tickers), pool_id=pool["_key"])
        check_stop()

        # ---- 3. forecast -----------------------------------------------
        needed = models_needed(pred_c["models"])
        forecast_days = max(MAX_HORIZON_DAYS, max(horizon_days(h) for h in pred_c["horizons"]))
        stats = history_stats(tickers, training_start(pred_c["training"]))
        db = get_db()
        stored = {
            "lstm": {d["_key"]: d for d in db.collection("price_predictions").get_many(tickers)},
            "arima": {d["_key"]: d for d in db.collection("arima_predictions").get_many(tickers)},
        }
        tasks = {m: {} for m in needed}
        reused = {m: 0 for m in needed}
        skipped = []
        for t in tickers:
            st = stats.get(t)
            lookback = lookback_for(pred_c["training"], st) if st else 0
            if not st or min(lookback, st["total"]) < MIN_HISTORY_DAYS:
                skipped.append(t)  # too little history to forecast; fails the prediction step
                continue
            for model in needed:
                epochs = pred_c["epochs"] if model == "lstm" else None
                if pred_c["reuse_forecasts"] and forecast_reusable(stored[model].get(t), lookback, st, forecast_days, epochs):
                    reused[model] += 1
                    continue
                if model == "lstm":
                    res = train_lstm_prediction.delay(ticker=t, epochs=pred_c["epochs"], lookback_days=lookback, forecast_days=forecast_days)
                else:
                    res = train_arima_prediction.delay(ticker=t, lookback_days=lookback, forecast_days=forecast_days)
                tasks[model][t] = res.id
                children.append(res.id)

        total = sum(len(v) for v in tasks.values())
        while True:
            counts = {m: {"total": len(tasks[m]), "done": 0, "failed": 0, "running": 0, "reused": reused[m]} for m in needed}
            for m in needed:
                for task_id in tasks[m].values():
                    state = AsyncResult(task_id, app=celery_app).state
                    if state == "SUCCESS":
                        counts[m]["done"] += 1
                    elif state in ("FAILURE", "REVOKED"):
                        counts[m]["failed"] += 1
                    elif state in ("STARTED", "PROGRESS"):
                        counts[m]["running"] += 1
            finished = sum(c["done"] + c["failed"] for c in counts.values())
            parts = [
                f"{m.upper()} {c['done'] + c['failed']}/{c['total']}" + (f" (+{c['reused']} reused)" if c["reused"] else "")
                for m, c in counts.items()
            ]
            waiting = finished < total and not any(c["running"] for c in counts.values())
            step(
                "forecast", finished / total if total else 1,
                ("Waiting for a free forecast worker · " if waiting else "Forecasting · ") + " · ".join(parts),
                status="running", counts=counts, skipped=skipped,
            )
            if finished >= total:
                break
            check_stop()
            time.sleep(POLL_SECONDS)

        rows = evaluate_forecasts(tickers, pred_c)
        passed = [r["ticker"] for r in rows if r["passed"]]
        step(
            "forecast", 1, f"{len(passed)} of {len(tickers)} companies pass the prediction criteria",
            status="done", passed=len(passed), rows=rows,
        )
        if len(passed) < 2:
            raise PolicyRunError(f"Only {len(passed)} companies pass the prediction criteria -- need at least 2")
        dropped = [t for t in tickers if t not in set(passed)]
        if dropped:
            reason = {r["ticker"]: {"reason": r["reason"], "models": r["models"]} for r in rows if not r["passed"]}
            reason["_rule"] = f"policy prediction criteria '{run['criteria']['prediction']['name']}'"
            pool = refine_pool(pool["_key"], drop=dropped, reason=reason)
        save(pool_id=pool["_key"])
        check_stop()

        # ---- 4. portfolio ----------------------------------------------
        step("portfolio", 0, "Waiting for the RL worker...", status="running")
        pct = lambda v: None if v is None else v / 100  # noqa: E731
        rl = train_rl_portfolio.delay(
            universe=pool["tickers"],
            risk_aversion=port_c["risk_aversion"],
            timesteps=port_c["timesteps"],
            portfolio_name=f"{name} · {today}",
            mode=port_c["mode"],
            min_companies=port_c["min_companies"],
            max_companies=port_c["max_companies"],
            lookback_days=port_c["trend_window_days"],
            max_volatility=pct(port_c["max_volatility_pct"]),
            min_return=pct(port_c["min_return_pct"]),
            max_weight_range=pct(port_c.get("max_weight_range_pct")),
            required_tickers=port_c.get("required_tickers") or [],
            excluded_tickers=port_c.get("excluded_tickers") or [],
            pool_id=pool["_key"],
        )
        children.append(rl.id)
        while True:
            state, payload = _snapshot(rl.id)
            if state == "SUCCESS":
                break
            if state in ("FAILURE", "REVOKED"):
                raise PolicyRunError(f"RL training failed: {payload}")
            info = payload if state == "PROGRESS" and isinstance(payload, dict) else {}
            if info.get("stage") == "selecting":
                step("portfolio", 0.02, "Selecting companies with the portfolio criteria...")
            elif info.get("total"):
                done = min(info.get("completed", 0), info["total"])
                step("portfolio", done / info["total"], f"Training the RL agent · {done:,} / {info['total']:,} steps")
            check_stop()
            time.sleep(POLL_SECONDS)

        result = payload
        step(
            "portfolio", 1, f"Portfolio created with {len(result['holdings'])} companies",
            status="done", portfolio_id=result["portfolio_id"], metrics=result["metrics"],
            constraints=result.get("constraints"), holdings=len(result["holdings"]),
            mandatory=result.get("mandatory"), user_excluded=result.get("user_excluded"),
        )
        finish(save, started, "succeeded", portfolio_id=result["portfolio_id"], percent=100,
               message=f"Done -- portfolio with {len(result['holdings'])} companies")
    except Cancelled:
        for task_id in children:
            if AsyncResult(task_id, app=celery_app).state not in DONE_STATES:
                request_stop(task_id)  # the import stops cooperatively between tickers
                celery_app.control.revoke(task_id, terminate=True)
        finish(save, started, "cancelled", message="Cancelled", steps=_mark_current(run, "cancelled"))
    except Exception as exc:  # noqa: BLE001 - recorded on the run for the UI
        finish(save, started, "failed", error=str(exc), message=str(exc), steps=_mark_current(run, "failed"))
    finally:
        clear_stop(self.request.id)
    return {"run_id": run_id, "status": run["status"], "portfolio_id": run.get("portfolio_id")}


def _mark_current(run: dict, status: str) -> dict:
    """Steps with the one that was in progress marked failed/cancelled."""
    steps = run.get("steps", {})
    current = run.get("step")
    if current in steps and steps[current].get("status") == "running":
        steps = {**steps, current: {**steps[current], "status": status}}
    return steps


def finish(save, started: datetime, status: str, **patch):
    ended = datetime.now(timezone.utc)
    save(status=status, finished_at=ended.isoformat(), wall_seconds=round((ended - started).total_seconds(), 1), **patch)
