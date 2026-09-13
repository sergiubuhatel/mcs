"""Celery worker entry point: `celery -A celery_worker.celery_app worker --loglevel=info`."""

from app.tasks.celery_app import celery_app

__all__ = ["celery_app"]
