"""Cooperative-stop flags for long-running tasks, stored as plain Redis keys
-- deliberately NOT built on Celery's AbortableTask, whose abort marker is
stored via the same `store_result()` call our own `update_state(state=
"PROGRESS", ...)` progress updates use. Interleaving the two overwrites
whichever wrote last: a stop requested between two progress updates could
be immediately clobbered by the next `update_state()` call, so the task
would never actually observe it. A separate key sidesteps that entirely.
"""

import redis

from ..config import REDIS_URL

_STOP_KEY_TTL = 60 * 60  # 1 hour; stale keys expire on their own
_client = redis.from_url(REDIS_URL)


def _key(task_id: str) -> str:
    return f"task_stop:{task_id}"


def request_stop(task_id: str, ttl: int = _STOP_KEY_TTL) -> None:
    _client.setex(_key(task_id), ttl, "1")


def is_stop_requested(task_id: str) -> bool:
    return _client.exists(_key(task_id)) > 0


def clear_stop(task_id: str) -> None:
    _client.delete(_key(task_id))


class TaskStopped(Exception):
    """Raised inside a task that was asked to stop (ends it as FAILURE)."""


def raise_if_stopped(task_id: str) -> None:
    if is_stop_requested(task_id):
        raise TaskStopped("Cancelled")
