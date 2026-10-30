"""States of many Celery tasks, cheaply.

`AsyncResult(id).state` is one Redis GET per task: a forecast run over every
company has ~5,000 jobs, so reading its progress that way took seconds per
request -- and with every open page asking (bottom bar, Dashboard, forecast
pages), it tied up all of the backend's request threads and froze the app.

So: one MGET per 1,000 tasks, and a finished task (SUCCESS / FAILURE /
REVOKED never changes) is remembered in this process and not read again.
Finished LSTM/ARIMA results carry whole forecasts (~30 KB each, ~150 MB for a
full run), so only small payloads are decoded; for big ones the state and
`train_seconds` are picked out of the raw JSON.
"""

import re

from .celery_app import celery_app

_CHUNK = 1000
_FINAL_STATES = {"SUCCESS", "FAILURE", "REVOKED"}
_DECODE_LIMIT = 4096  # bytes; bigger payloads are scanned, not decoded
_MAX_REMEMBERED = 200_000
_final: dict[str, tuple[str, object]] = {}

_STATUS = re.compile(rb'"status":\s*"(\w+)"')
_TRAIN_SECONDS = re.compile(rb'"train_seconds":\s*([0-9.eE+-]+)')


def _error_text(result) -> str:
    """The message of a stored exception ({exc_type, exc_message, ...})."""
    if isinstance(result, dict) and "exc_type" in result:
        message = result.get("exc_message")
        if isinstance(message, (list, tuple)):
            message = " ".join(str(m) for m in message)
        return f"{result['exc_type']}: {message}" if message else str(result["exc_type"])
    return str(result)


def _parse(payload: bytes) -> tuple[str, object]:
    backend = celery_app.backend
    if len(payload) > _DECODE_LIMIT:
        m = _STATUS.search(payload)
        state = m.group(1).decode() if m else "PENDING"
        if state == "SUCCESS":
            seconds = _TRAIN_SECONDS.search(payload)
            return state, {"train_seconds": float(seconds.group(1))} if seconds else {}
        if state not in _FINAL_STATES:
            return state, None
    meta = backend.decode_result(payload)
    state, result = meta.get("status", "PENDING"), meta.get("result")
    if state in ("FAILURE", "REVOKED"):
        return state, _error_text(result)
    if state == "SUCCESS":  # keep only what callers read
        return state, {"train_seconds": result.get("train_seconds")} if isinstance(result, dict) else {}
    return state, result


def task_states(task_ids: list[str]) -> dict[str, tuple[str, object]]:
    """{task_id: (state, info)}; a task with no stored result is PENDING.
    info: SUCCESS -> {"train_seconds": ...}, FAILURE / REVOKED -> the error
    text, PROGRESS -> its progress dict."""
    backend = celery_app.backend
    out = {t: _final[t] for t in task_ids if t in _final}
    todo = [t for t in task_ids if t not in out]
    for i in range(0, len(todo), _CHUNK):
        chunk = todo[i:i + _CHUNK]
        raw = backend.client.mget([backend.get_key_for_task(t) for t in chunk])
        for task_id, payload in zip(chunk, raw):
            if payload is None:
                out[task_id] = ("PENDING", None)
                continue
            out[task_id] = _parse(payload)
            if out[task_id][0] in _FINAL_STATES:
                if len(_final) >= _MAX_REMEMBERED:
                    _final.clear()
                _final[task_id] = out[task_id]
    return out
