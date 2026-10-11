"""Policies and their criteria (CRUD + duplicate), and running a policy.

    /api/criteria/<kind>                 GET list, POST create   (kind = data | screen | prediction | portfolio)
    /api/criteria/<kind>/<id>            GET, PUT, DELETE
    /api/criteria/<kind>/<id>/duplicate  POST
    /api/policies                        GET list (each with its last run), POST create
    /api/policies/<id>                   GET, PUT, DELETE
    /api/policies/<id>/duplicate         POST
    /api/policies/<id>/run               POST -> a policy_runs document (poll it)
    /api/policies/<id>/runs              GET run history
    /api/policies/runs/<run_id>          GET one run (progress)
    /api/policies/runs/<run_id>/cancel   POST
"""

import uuid
from datetime import datetime, timezone

from celery.result import AsyncResult
from flask import Blueprint, jsonify, request

from ..db.arango_client import get_db
from ..services import policy_service as svc
from ..tasks.celery_app import celery_app
from ..tasks.policy_tasks import run_policy
from ..tasks.stop_flags import request_stop

bp = Blueprint("policies", __name__)

ACTIVE = ("queued", "running")
DONE_STATES = {"SUCCESS", "FAILURE", "REVOKED"}


def _kind_or_404(kind: str):
    return None if kind in svc.KINDS else (jsonify({"error": f"Unknown criteria kind '{kind}'"}), 404)


# ------------------------------------------------------------------- criteria

@bp.get("/api/criteria/<kind>")
def criteria_list(kind):
    if err := _kind_or_404(kind):
        return err
    return jsonify({"criteria": svc.list_criteria(kind)})


@bp.post("/api/criteria/<kind>")
def criteria_create(kind):
    if err := _kind_or_404(kind):
        return err
    try:
        return jsonify(svc.create_criteria(kind, request.get_json(silent=True) or {})), 201
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400


@bp.get("/api/criteria/<kind>/<criteria_id>")
def criteria_detail(kind, criteria_id):
    if err := _kind_or_404(kind):
        return err
    doc = svc.get_criteria(kind, criteria_id)
    return jsonify(doc) if doc else (jsonify({"error": "Criteria not found"}), 404)


@bp.put("/api/criteria/<kind>/<criteria_id>")
def criteria_update(kind, criteria_id):
    if err := _kind_or_404(kind):
        return err
    try:
        doc = svc.update_criteria(kind, criteria_id, request.get_json(silent=True) or {})
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify(doc) if doc else (jsonify({"error": "Criteria not found"}), 404)


@bp.post("/api/criteria/<kind>/<criteria_id>/duplicate")
def criteria_duplicate(kind, criteria_id):
    if err := _kind_or_404(kind):
        return err
    doc = svc.duplicate_criteria(kind, criteria_id)
    return (jsonify(doc), 201) if doc else (jsonify({"error": "Criteria not found"}), 404)


@bp.delete("/api/criteria/<kind>/<criteria_id>")
def criteria_delete(kind, criteria_id):
    if err := _kind_or_404(kind):
        return err
    try:
        deleted = svc.delete_criteria(kind, criteria_id)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 409
    return jsonify({"deleted": criteria_id}) if deleted else (jsonify({"error": "Criteria not found"}), 404)


# ------------------------------------------------------------------- policies

@bp.get("/api/policies")
def policy_list():
    return jsonify({"policies": [_reconcile_last(p) for p in svc.list_policies()]})


@bp.post("/api/policies")
def policy_create():
    try:
        return jsonify(svc.create_policy(request.get_json(silent=True) or {})), 201
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400


@bp.get("/api/policies/<policy_id>")
def policy_detail(policy_id):
    doc = svc.get_policy(policy_id)
    return jsonify(doc) if doc else (jsonify({"error": "Policy not found"}), 404)


@bp.put("/api/policies/<policy_id>")
def policy_update(policy_id):
    try:
        doc = svc.update_policy(policy_id, request.get_json(silent=True) or {})
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify(doc) if doc else (jsonify({"error": "Policy not found"}), 404)


@bp.post("/api/policies/<policy_id>/duplicate")
def policy_duplicate(policy_id):
    doc = svc.duplicate_policy(policy_id)
    return (jsonify(doc), 201) if doc else (jsonify({"error": "Policy not found"}), 404)


@bp.delete("/api/policies/<policy_id>")
def policy_delete(policy_id):
    for run in svc.list_runs(policy_id):
        if run["status"] in ACTIVE:
            return jsonify({"error": "This policy is running -- cancel the run first"}), 409
    if not svc.delete_policy(policy_id):
        return jsonify({"error": "Policy not found"}), 404
    return jsonify({"deleted": policy_id})


# ----------------------------------------------------------------------- runs

@bp.post("/api/policies/<policy_id>/run")
def policy_run(policy_id):
    policy = svc.get_policy(policy_id)
    if policy is None:
        return jsonify({"error": "Policy not found"}), 404
    if any(_reconcile(r)["status"] in ACTIVE for r in svc.list_runs(policy_id, limit=5)):
        return jsonify({"error": "This policy is already running"}), 409
    criteria = {}
    for kind in svc.KINDS:
        if kind in svc.OPTIONAL_KINDS and not policy.get(f"{kind}_criteria_id"):
            criteria[kind] = None  # no import: the run uses the data already stored
            continue
        doc = svc.get_criteria(kind, policy[f"{kind}_criteria_id"])
        if doc is None:
            return jsonify({"error": f"The policy's {kind} criteria no longer exists -- edit the policy"}), 400
        criteria[kind] = {k: v for k, v in doc.items() if not k.startswith("_") or k == "_key"}

    run = {
        "_key": str(uuid.uuid4()),
        "policy_id": policy_id,
        "policy_name": policy["name"],
        # Snapshot: editing a criteria later doesn't change what this run did.
        "criteria": criteria,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "status": "queued",
        "step": "data",
        "step_index": 1,
        "steps_total": len(svc.KINDS),
        "percent": 0,
        "message": "Waiting for the policy worker...",
        "steps": {},
    }
    col = get_db().collection("policy_runs")
    col.insert(run)
    task = run_policy.delay(run["_key"])
    col.update({"_key": run["_key"], "task_id": task.id})
    run["task_id"] = task.id
    return jsonify(run), 202


@bp.get("/api/policies/<policy_id>/runs")
def policy_runs(policy_id):
    return jsonify({"runs": [_reconcile(r) for r in svc.list_runs(policy_id)]})


@bp.get("/api/policies/runs/<run_id>")
def run_detail(run_id):
    col = get_db().collection("policy_runs")
    if not col.has(run_id):
        return jsonify({"error": "Run not found"}), 404
    return jsonify(_reconcile(col.get(run_id)))


@bp.post("/api/policies/runs/<run_id>/cancel")
def run_cancel(run_id):
    col = get_db().collection("policy_runs")
    if not col.has(run_id):
        return jsonify({"error": "Run not found"}), 404
    run = col.get(run_id)
    if run["status"] not in ACTIVE:
        return jsonify(run)
    if run.get("task_id"):
        request_stop(run["task_id"])  # a running task stops itself and its jobs
        if run["status"] == "queued":
            celery_app.control.revoke(run["task_id"])
    if run["status"] == "queued":
        col.update({"_key": run_id, "status": "cancelled", "message": "Cancelled",
                    "finished_at": datetime.now(timezone.utc).isoformat()})
    else:
        col.update({"_key": run_id, "message": "Cancelling..."})
    return jsonify(col.get(run_id))


def _reconcile(run: dict | None) -> dict | None:
    """A run still marked active whose task is gone (worker restarted /
    crashed) is marked failed, so it doesn't look stuck forever."""
    if not run or run["status"] not in ACTIVE or not run.get("task_id"):
        return run
    state = AsyncResult(run["task_id"], app=celery_app).state
    if state not in DONE_STATES:
        return run
    col = get_db().collection("policy_runs")
    run = col.get(run["_key"])  # the task records its outcome just before finishing
    if run["status"] in ACTIVE:
        patch = {"status": "failed", "message": "The policy worker stopped before the run finished",
                 "error": "The policy worker stopped before the run finished",
                 "finished_at": datetime.now(timezone.utc).isoformat()}
        col.update({"_key": run["_key"], **patch})
        run = {**run, **patch}
    return run


def _reconcile_last(policy: dict) -> dict:
    """The list grid only needs the last run's progress, not its criteria
    snapshot or per-ticker forecast rows (GET .../runs has those)."""
    run = _reconcile(policy.get("last_run"))
    if run:
        steps = {k: {f: v for f, v in s.items() if f != "rows"} for k, s in (run.get("steps") or {}).items()}
        run = {**{k: v for k, v in run.items() if k != "criteria"}, "steps": steps}
    return {**policy, "last_run": run}
