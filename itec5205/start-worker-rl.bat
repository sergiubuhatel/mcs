@echo off
REM Launches the Celery worker dedicated to the "rl" queue
REM (train_rl_portfolio - PPO portfolio allocation training).
REM Run from the repo root, in its own terminal: start-worker-rl.bat

cd /d "%~dp0backend"

call env\Scripts\activate.bat

set ARANGO_HOST=http://localhost:8529
set ARANGO_PASSWORD=root
set REDIS_URL=redis://localhost:6379/0

celery -A celery_worker.celery_app worker --loglevel=info --pool=solo -Q rl -n rl@%%h
