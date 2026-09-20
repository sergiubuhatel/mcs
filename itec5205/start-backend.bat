@echo off
REM Launches the backend locally: venv setup, env vars, DB init, and the Flask dev server.
REM Run from the repo root: start-backend.bat

set REPO_ROOT=%~dp0

cd /d "%REPO_ROOT%backend"

if not exist "env\Scripts\activate.bat" (
    python -m venv env
)

call env\Scripts\activate.bat

pip install -r requirements.txt

set ARANGO_HOST=http://localhost:8529
set ARANGO_PASSWORD=root
set REDIS_URL=redis://localhost:6379/0
set TICKERS_FILE=%REPO_ROOT%tickers.txt

python scripts\init_db.py
python wsgi.py
