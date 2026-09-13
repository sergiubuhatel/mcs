# Development Guide — S&P 500 Investment Screener & RL Portfolio Builder

Everything you need to understand how this system is put together, how its
pieces talk to each other, and how to build/run/extend it. For the
end-user walkthrough see [`USER_GUIDE.md`](./USER_GUIDE.md); for the
academic writeup see [`paper/ITEC5205_ResearchPaper.docx`](../paper/ITEC5205_ResearchPaper.docx).

## 1. Architecture at a glance

```
┌─────────────┐   HTTP (REST) / WebSocket  ┌──────────────┐        proxy_pass        ┌──────────────┐
│   React /   │ ─────────────────────────► │    nginx     │ ───────────────────────► │   Waitress   │
│   Redux /   │ ◄───────────────────────── │  (frontend   │ ◄─────────────────────── │  (WSGI app   │
│ Redux-Saga  │   (Socket.IO, progress)    │  container   │   127.0.0.1:8000 only    │   server)    │
│  (Vite)     │                            │  + backend   │                          │  Flask app   │
└─────────────┘                            │  container)  │                          │ (app/api/*)  │
                                            └──────────────┘                          └──────┬───────┘
                                                                                              │
                                                    enqueue task (Redis)                      │  read/write
                                               ┌──────────────────────────────────────────────┤
                                               ▼                                               ▼
                                        ┌─────────────┐                                 ┌─────────────┐
                                        │    Redis    │                                 │  ArangoDB   │
                                        │ (broker +   │                                 │ (documents, │
                                        │  Socket.IO  │                                 │  AQL query) │
                                        │  pub/sub)   │                                 └─────────────┘
                                        └──────┬──────┘
                                               │ pulls tasks
                                               ▼
                                        ┌─────────────┐
                                        │   Celery    │  runs: bulk Yahoo import,
                                        │   worker    │  PPO (RL) training, LSTM training
                                        └─────────────┘
                                               │
                                               ▼
                                        yfinance (Yahoo Finance), stable-baselines3 (PPO),
                                        PyTorch (LSTM)
```

Six Docker services (`docker-compose.yml`): `arangodb`, `redis`,
`backend`, `worker`, `flower` (Celery monitoring UI), `frontend`.
**Both `frontend` and `backend` run nginx as their public-facing web
server** — `frontend`'s nginx serves the built React static files and
reverse-proxies `/api` and `/socket.io` to the `backend` container;
`backend`'s nginx (bound to the container's port 5000) reverse-proxies
everything to **Waitress**, a pure-Python production WSGI server bound to
`127.0.0.1:8000` inside that same container (not reachable directly from
outside it). Flask-SocketIO's `async_mode="threading"` wraps the Flask
app's own `wsgi_app`, so Waitress serves the REST API and Socket.IO's
long-polling transport identically, through the same WSGI callable — see
`backend/docker-entrypoint.sh` (starts Waitress in the background, then
runs nginx in the foreground) and `backend/nginx.conf`.

**Why a task queue at all?** Importing ~500 tickers from Yahoo Finance, or
training a PPO/LSTM model, takes far longer than an HTTP request should
block for. The Flask process only ever *enqueues* work (`task.delay(...)`,
returns instantly with a `task_id`); the Celery `worker` process does the
actual work, publishing progress back over Redis so the browser can watch
it live instead of polling blind.

## 2. Backend (`backend/`)

```
backend/
  app/
    __init__.py          create_app(): registers blueprints, CORS, Socket.IO, health check
    config.py             all config from env vars (ARANGO_*, REDIS_URL, CORS_ORIGINS, ...)
    extensions.py          shared `socketio` (Flask-SocketIO) + `cors` instances
    sockets.py              Socket.IO `join`/`leave` room handlers
    db/
      arango_client.py      get_db(), COLLECTIONS + index definitions, ensure_collections()
    services/                the actual business logic (no Flask/Celery imports here except socketio emit)
      yahoo_import.py          Yahoo Finance -> history/stats/financial-ratio rows -> Arango upsert
      screening.py              AQL query builder for company search/filter/sort
      portfolio_service.py      portfolio CRUD + return/volatility/Sharpe from historical prices
      pool_service.py            candidate-pool CRUD (search results -> saved ticker list)
      rl_service.py               builds the returns matrix, trains PPO, derives a recommended allocation
      lstm_service.py             per-ticker LSTM price forecaster (train + recursive multi-step forecast)
    rl/
      portfolio_env.py           the Gymnasium environment PPO trains against
    tasks/
      celery_app.py               Celery app (Redis broker+backend), `set_default()` (see gotcha below)
      import_tasks.py              `import_sp500_data` Celery task
      rl_tasks.py                   `train_rl_portfolio` Celery task
      predict_tasks.py              `train_lstm_prediction` Celery task
    api/                        thin Flask blueprints; validate input, call services/tasks, return JSON
      companies.py, pools.py, portfolios.py, rl.py, data.py, predictions.py
  scripts/init_db.py         one-off: create collections + indexes
  wsgi.py                    exposes `app`; `python wsgi.py` serves it with Waitress
  celery_worker.py            Celery worker entrypoint (`celery -A celery_worker.celery_app worker`)
  nginx.conf                  backend container's nginx config: proxy_pass -> 127.0.0.1:8000 (Waitress)
  docker-entrypoint.sh          starts Waitress in the background, then runs nginx in the foreground
  Dockerfile, requirements.txt
```

**Design rule followed throughout:** `services/` never imports Flask or
Celery — they're plain Python functions you can call from a script, a
Flask route, or a Celery task identically. `api/` and `tasks/` are thin
adapters around them.

### ArangoDB schema (document collections)

| Collection          | Key                  | Holds |
|----------------------|-----------------------|-------|
| `sectors`             | slugified sector name | `{name}` |
| `industries`          | slugified industry name | `{name, sector}` |
| `companies`            | ticker                | `{name, sector, industry, exchange, updated_at}` |
| `stock_prices`          | `TICKER_YYYY-MM-DD`   | `{ticker, date, close, previous, value_change, percentage_change}` |
| `stock_stats`            | ticker                | latest snapshot: price, market cap, P/E, beta, dividend yield, ... |
| `financial_ratios`        | ticker                | ROE, ROA, debt/equity, current ratio, margins, revenue growth (from Yahoo's income statement/balance sheet) |
| `pools`                    | uuid                  | `{name, tickers[], filters, created_at}` |
| `portfolios`                | uuid                  | `{name, method, holdings:[{ticker,weight}], expected_return, expected_volatility, sharpe_ratio}` |
| `rl_runs`                    | uuid (= Celery task id) | PPO run metadata: hyperparams, universe, resulting portfolio id, model path |
| `price_predictions`            | ticker                | latest LSTM forecast + test RMSE/MAE |

`sectors`/`industries` exist as their own collections (not just distinct
values scanned off `companies`) specifically so the Screener's dropdowns
are cheap lookups, and so sector/industry are first-class, independently
searchable entities per the course's data-modeling emphasis. ArangoDB
document keys disallow spaces/`&`/`/`; sector/industry *names* (e.g. "Oil
& Gas Integrated") are slugified for `_key` but stored unmodified in
`name`/on `companies.sector`, so filtering and display both use the
original readable string.

### The RL environment (`app/rl/portfolio_env.py`)

A Gymnasium `Env` where:

- **State** = the last `window` days of returns for every asset in the
  pool (flattened) + the current portfolio weights.
- **Action** = a real vector of length N, softmax-normalized into
  long-only weights summing to 1.
- **Reward** = portfolio daily return − `risk_aversion` × trailing
  volatility (a Sharpe-like signal).
- Trained with `stable-baselines3`'s PPO (`MlpPolicy`) in
  `services/rl_service.py::train_and_recommend`, which pulls the pool's
  returns matrix out of `stock_prices`, trains, then applies the learned
  policy to the most recent window to produce today's recommended
  allocation.

### The LSTM predictor (`app/services/lstm_service.py`)

A small 1-layer PyTorch LSTM trained per-ticker on min-max-scaled daily
closes (80/20 chronological train/test split), evaluated with RMSE/MAE on
the held-out tail, then used for a recursive 7-trading-day forecast
(predict one day, feed it back in, repeat).

### Real-time progress: Socket.IO over Redis

`app/extensions.py` creates one `flask_socketio.SocketIO` instance
configured with `message_queue=<redis>`. The **same object** is imported
in both the Flask process (where `socketio.init_app(app)` also runs the
Socket.IO server) and in Celery tasks (where it's used purely to
`.emit(event, data, room=task_id)` — Flask-SocketIO forwards this to
connected browser clients via Redis pub/sub, with no Socket.IO server
running in the worker process at all). The browser joins a room named
after the `task_id` right after triggering a job (see `app/sockets.py`'s
`join`/`leave` handlers), then listens for `import_progress` /
`rl_progress` / `prediction_progress` events. A DB-polling fallback
(`GET .../status/<task_id>`) exists for when the socket drops.

### ⚠️ A real gotcha we hit: `@shared_task` vs. `@celery_app.task`

Celery's `@shared_task` decorator resolves against `celery.current_app` —
a lazy proxy that only points at *your* `Celery(...)` instance in a
process that explicitly launched via `celery -A your_module.celery_app
worker` (which calls `set_default()`/`set_current()` as part of its
bootstrapping). In the **Flask** process, nothing ever does that, so
`@shared_task`-decorated tasks silently resolved against Celery's global
default app — a bare `Celery()` whose default broker is
`amqp://guest@localhost//` — and every `.delay()` call from an API route
failed with `ConnectionRefusedError` while trying to speak AMQP to a
RabbitMQ port nothing was listening on, even though `celery_app.conf.broker_url`
correctly printed `redis://redis:6379/0` and ad-hoc connections made
directly through `celery_app` worked fine. The fix: bind every task with
`@celery_app.task(...)` directly (not `@shared_task`), and call
`celery_app.set_default()` right after constructing it as a second line
of defense. If you ever add a new Celery task module, decorate it with
`@celery_app.task`, not `@shared_task`.

## 3. Frontend (`frontend/`)

Vite + React 18 + Redux Toolkit + **Redux-Saga** (not thunks) +
React Router + Recharts + `socket.io-client`.

```
frontend/src/
  api/client.js            axios instance (baseURL = VITE_API_URL, or same-origin if empty string)
  api/socket.js             shared socket.io-client instance + joinRoom()/leaveRoom() helpers
  app/store.js               configureStore + redux-saga middleware (thunk middleware disabled)
  app/rootSaga.js              forks every feature's saga
  features/
    companies/                companiesSlice (filters/results/sectors/industries/selection) + companiesSaga (fetches) + CompanyFilters.jsx + CompanyTable.jsx
    pools/                     poolsSlice + poolsSaga (CRUD) + SavePoolForm.jsx
    portfolios/                 portfoliosSlice + portfoliosSaga (CRUD) + ManualPortfolioForm.jsx
    rl/                          rlSlice + rlSaga (train, listen) + RLTrainingPanel.jsx
    predictions/                  predictionsSlice + predictionsSaga (train, listen) + PredictionPanel.jsx
  pages/                    ScreenerPage, PoolsPage, PortfoliosPage, CompanyDetailPage (route targets)
  App.jsx, main.jsx           router + Redux <Provider>
```

**Why Redux-Saga instead of RTK's built-in thunks:** the RL/LSTM training
flows aren't a single request/response — they're *start a job, then
consume a live event stream until it says "done"*. A saga expresses this
naturally with `eventChannel` (wraps the shared socket's event emitter as
something sagas can `take()` from) raced (`race()`) against a polling
fallback generator, so whichever resolves first wins:

```js
// simplified shape of features/rl/rlSaga.js
function* handleTrain(action) {
  const { data } = yield call(apiClient.post, "/api/rl/train", action.payload);
  const channel = createProgressChannel("rl_progress", data.task_id); // joins the room too
  const { viaSocket, viaPoll } = yield race({
    viaSocket: call(consumeChannelUntilDone, channel),   // take() loop until stage === "done"
    viaPoll: call(pollStatusUntilDone, data.task_id),     // GET /status every few seconds
  });
  yield put(trainSucceeded(viaSocket || viaPoll));
}
```

The `predictions` feature (LSTM) follows the identical pattern against
`/api/predictions/train` + `prediction_progress`.

### Same-origin vs. local dev API URL

`VITE_API_URL` is read via `import.meta.env.VITE_API_URL !== undefined ?
... : "http://localhost:5000"` (not `||`) specifically so an **explicit
empty string** (set in the Docker build, see `frontend/Dockerfile`) means
"same origin, let nginx proxy it" — which is distinct from "unset" (local
`npm run dev`, where it falls back to `http://localhost:5000` directly).
`frontend/nginx.conf` proxies `/api/` and `/socket.io/` to the `backend`
container so the built app never needs to know the backend's real address.

## 4. Running it

### Docker Compose (everything at once)

```
cp .env.example .env        # set ARANGO_PASSWORD if you want something other than "root"
mkdir -p C:\docker-data\arangodb   # the bind-mounted ArangoDB data directory (Windows path)
docker compose up -d --build
docker compose exec backend python scripts/init_db.py   # once, to create collections/indexes
```

Then see [`USER_GUIDE.md`](./USER_GUIDE.md) for triggering the data import
and using the app. `docker compose logs -f backend worker` to watch
requests/tasks; http://localhost:5555 (Flower) to watch Celery tasks
visually.

To rebuild just one service after a code change: `docker compose build
backend worker && docker compose up -d backend worker` (backend and
worker share the same image/Dockerfile, so both need rebuilding whenever
`backend/` changes — the worker is a shared codebase, not a separate app).

### Running services locally without Docker (faster inner loop)

Backend (needs a local ArangoDB + Redis, e.g. `docker compose up -d arangodb redis`):

```
cd backend
python -m venv env
env\Scripts\activate   # Windows
pip install -r requirements.txt
set ARANGO_HOST=http://localhost:8529
set ARANGO_PASSWORD=root
set REDIS_URL=redis://localhost:6379/0
python scripts/init_db.py
python wsgi.py                       # Waitress serving Flask + Socket.IO on :5000 (no nginx needed locally)
```

In a second terminal, the Celery worker (same env vars):

```
celery -A celery_worker.celery_app worker --loglevel=info --pool=solo
```

(`--pool=solo` avoids multiprocessing quirks on Windows; fine for a dev
box, not for production throughput.)

Frontend:

```
cd frontend
npm install
npm run dev          # http://localhost:5173, VITE_API_URL defaults to http://localhost:5000
```

### Environment variables reference

| Variable | Default | Used by |
|---|---|---|
| `ARANGO_HOST` | `http://localhost:8529` | backend, worker |
| `ARANGO_DB` | `investing` | backend, worker |
| `ARANGO_USER` / `ARANGO_PASSWORD` | `root` / `root` | backend, worker, ArangoDB container |
| `REDIS_URL` | `redis://localhost:6379/0` | backend, worker (Celery broker+backend) |
| `SOCKETIO_REDIS_URL` | `<REDIS_URL's db>/1` | backend, worker (Socket.IO pub/sub — kept on a separate logical DB from the Celery broker) |
| `TICKERS_FILE` | `/data/tickers.txt` | backend, worker (default universe for `/api/data/import`) |
| `RL_MODELS_DIR` | `/data/rl_models` | backend, worker (saved PPO `.zip` / LSTM `.pt` files) |
| `WAITRESS_HOST` / `WAITRESS_PORT` | `0.0.0.0` / `5000` (`127.0.0.1` / `8000` in Docker, set by `docker-entrypoint.sh`) | backend's `wsgi.py` only |
| `CORS_ORIGINS` | `http://localhost:5173` | backend |
| `VITE_API_URL` | `http://localhost:5000` (unset) / `""` (Docker build) | frontend |

## 5. API reference

All routes are under `/api`. Async ones return `{"task_id": "..."}` (202)
immediately; poll `GET .../status/<task_id>` or listen on the matching
Socket.IO room/event.

| Method & path | Purpose |
|---|---|
| `GET /api/companies` | Search/filter/sort (`sector`, `industry`, `q`, `<field>_min`/`_max` for any of `FILTERABLE_RANGES`, `sort_by`, `sort_dir`, `limit`, `offset`) |
| `GET /api/companies/sectors` | Distinct sectors |
| `GET /api/companies/industries?sector=` | Distinct industries, optionally scoped to a sector |
| `GET /api/companies/<ticker>` | Company + stats + ratios + full price history |
| `POST /api/pools` `{name, tickers[]}` | Save a candidate pool |
| `GET /api/pools`, `GET/DELETE /api/pools/<id>` | List/inspect/delete pools |
| `POST /api/portfolios` `{name, holdings:[{ticker,weight}], method?, notes?}` | Save a portfolio (weights auto-normalized) |
| `GET /api/portfolios`, `GET/DELETE /api/portfolios/<id>` | List/inspect/delete portfolios |
| `POST /api/rl/train` `{pool_id \| universe[], risk_aversion?, timesteps?, window?, portfolio_name?}` | Async: train PPO, save resulting portfolio. Socket.IO event: `rl_progress` |
| `GET /api/rl/status/<task_id>` | Poll RL training status/result |
| `POST /api/data/import` `{tickers[]?, period?, interval?}` | Async: bulk Yahoo Finance -> Arango import (defaults to the full `tickers.txt` universe). Socket.IO event: `import_progress` |
| `GET /api/data/import/status/<task_id>` | Poll import status/result |
| `POST /api/predictions/train` `{ticker, seq_len?, epochs?, hidden_size?, forecast_days?}` | Async: train the LSTM, store the forecast. Socket.IO event: `prediction_progress` |
| `GET /api/predictions/status/<task_id>` | Poll prediction training status/result |
| `GET /api/predictions/<ticker>` | Most recently stored forecast for a ticker |
| `GET /api/health` | Liveness check |

## 6. Troubleshooting / operational gotchas

- **`ArangoServerError`/`DatabaseListError: not authorized` when running a
  backend script locally**: `ARANGO_PASSWORD` wasn't set in that shell, so
  it defaulted to an empty string (`config.py`'s default). Set it to match
  whatever's in `.env` (`root` by default) alongside `ARANGO_HOST`.
- **`docker compose restart backend` (or rebuilding just `backend`) makes
  the app briefly 502 through port 8080, even though `curl localhost:5000`
  works**: nginx resolves a plain `proxy_pass http://backend:5000;`
  hostname to an IP **once**, when it starts. Recreating the `backend`
  container gives it a new IP, which `frontend`'s already-running nginx
  keeps trying (and failing) until it's restarted too. Fix: `docker
  compose restart frontend` after recreating `backend`. (`docker compose
  up -d --build` from a clean state doesn't hit this, since everything
  starts together.)
- **`502 Bad Gateway` from the backend's own nginx right after `docker
  compose up`**: this is likely just Waitress still mid-import of
  `torch`/`stable-baselines3` inside `create_app()` (a several-second
  cold start) — nginx is up before Waitress finishes binding to
  `127.0.0.1:8000`. It resolves itself within ~15-20s; no action needed.

## 7. Extending the system

- **New financial indicator**: add the yfinance field/derived ratio in
  `services/yahoo_import.py` (`STAT_FIELDS` or the ratio computation in
  `fetch_financial_ratios`), add it to `COLLECTIONS`' indexes if you'll
  filter/sort on it, then add it to `FILTERABLE_RANGES`/`SORTABLE_FIELDS`
  in `services/screening.py`, and finally to the frontend's `RANGE_FIELDS`
  (`CompanyFilters.jsx`) / `COLUMNS` (`CompanyTable.jsx`).
- **New background job**: add a function to a `services/*.py` module (no
  Flask/Celery imports), wrap it in a `@celery_app.task` in `tasks/*.py`
  (**not** `@shared_task` — see the gotcha above), register the module in
  `celery_app.py`'s `include=[...]`, add a Flask route in `api/*.py` that
  calls `.delay(...)`, and mirror the existing `rlSlice`/`rlSaga` pattern
  on the frontend if it needs live progress.
- **New collection**: add it to `COLLECTIONS` in `db/arango_client.py`
  (with any indexes), then re-run `scripts/init_db.py` (safe to re-run).
