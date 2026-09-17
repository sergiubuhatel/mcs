"""Celery application shared by the Flask API (to enqueue tasks) and the
worker process (to run them). Redis is both the broker and result backend.
"""

from celery import Celery

from .. import config

celery_app = Celery(
    "itec5205",
    broker=config.CELERY_BROKER_URL,
    backend=config.CELERY_RESULT_BACKEND,
    include=["app.tasks.import_tasks", "app.tasks.rl_tasks", "app.tasks.predict_tasks"],
)

celery_app.conf.update(
    task_track_started=True,
    result_expires=60 * 60 * 24,  # 1 day
    worker_hijack_root_logger=False,
    # Each job type gets its own queue so a dedicated worker process can run
    # per job type. On Windows, workers run with --pool=solo (single task at
    # a time), so a single worker consuming the default queue would fully
    # serialize import/RL-training/LSTM-training jobs against each other.
    task_routes={
        "import_sp500_data": {"queue": "import"},
        "train_rl_portfolio": {"queue": "rl"},
        "train_lstm_prediction": {"queue": "predict"},
    },
)

# Make this the process-wide default/current Celery app. Without this, a
# task module decorated with `@shared_task` resolves against Celery's
# global default app (bare `Celery()`, broker=amqp://localhost) whenever
# it's called from a process that never launched via `celery -A ...` (i.e.
# the Flask process) -- which silently tried to publish over AMQP instead
# of this app's Redis broker. Tasks are bound directly via `@celery_app.task`
# now, but keeping this avoids the same trap for anything using `shared_task`.
celery_app.set_default()
