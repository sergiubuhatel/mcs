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
                       ┌──────────────┬───────┴──────┬──────────────┐
                       ▼              ▼              ▼              ▼
                 worker-import    worker-rl     worker-lstm    worker-arima     (one Celery worker
                 queue `import`   queue `rl`    queue `lstm`   queue `arima`     per queue)
                 yfinance         PPO (SB3)     PyTorch        statsmodels
```

Docker services (`docker-compose.yml`): `arangodb`, `redis`, `init-db`
(one-shot: creates collections/indexes, then exits; everything else waits
for it), `backend`, `worker-import`, `worker-rl`, `worker-lstm`,
`worker-arima`, `worker-workflow` (queue `workflow`, see *Workflows* below), `flower` (Celery monitoring UI), `frontend`. Only
`backend` builds the Python image (`itec5205-backend`); the workers,
`init-db` and `flower` reuse it.
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
returns instantly with a `task_id`); a Celery worker does the actual work,
publishing progress back over Redis so the browser can watch it live
instead of polling blind. Each job type has its own queue and worker, so a
long RL run never blocks an import or a forecast, and each can be scaled
independently (`docker compose up -d --scale worker-arima=3`).

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
      lstm_service.py             per-ticker LSTM forecaster; also the shared lookback window + test split
      arima_service.py            per-ticker ARIMA forecaster (AIC search over (p,q) and drift)
      horizons.py                 the 1/2/3/4-month horizons (21/42/63/84 trading days)
      signal_service.py           signal board: fundamentals + RL + LSTM + ARIMA -> compound signal
      workflow_service.py           workflows + screen/prediction/portfolio criteria: CRUD, validation, run helpers
    rl/
      portfolio_env.py           the Gymnasium environment PPO trains against
    tasks/
      celery_app.py               Celery app (Redis broker+backend), `set_default()` (see gotcha below)
      import_tasks.py              `import_sp500_data` Celery task
      rl_tasks.py                   `train_rl_portfolio` Celery task
      predict_tasks.py              `train_lstm_prediction` Celery task (queue `lstm`)
      arima_tasks.py                `train_arima_prediction` Celery task (queue `arima`)
      workflow_tasks.py               `run_workflow` orchestrator (queue `workflow`)
    api/                        thin Flask blueprints; validate input, call services/tasks, return JSON
      companies.py, pools.py, portfolios.py, rl.py, data.py, predictions.py,
      arima.py, forecasts.py (batch LSTM+ARIMA over a pool/portfolio), signals.py,
      workflows.py (criteria + workflows CRUD, run/cancel)
  scripts/init_db.py         create collections + indexes (retries until ArangoDB is up; run by `init-db`)
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
| `pools`                    | uuid                  | `{name, tickers[], filters (the screen: sector/industry/q/ranges), created_at, root_pool_id, parent_pool_id, iteration, dropped[], refine_reason}` |
| `portfolios`                | uuid                  | `{name, method, holdings:[{ticker,weight}], source_pool_id, annual_return, expected_return, expected_volatility, sharpe_ratio}` |
| `rl_runs`                    | uuid (= Celery task id) | PPO run metadata: hyperparams, universe, resulting portfolio id, model path |
| `price_predictions`            | ticker                | latest LSTM forecast (84 daily steps + `horizons`) + test RMSE/MAE |
| `arima_predictions`            | ticker                | latest ARIMA forecast (+ 95% interval per step, order, drift) |
| `forecast_runs`                | uuid                  | batch forecast run: tickers, params, Celery task ids per model, `finished_at`, `wall_seconds`, `cancelled_at` |
| `criteria`                     | uuid                  | `{kind: data\|screen\|prediction\|portfolio, name, description, ...}` -- data: `scope`, `tickers[]`, `years`, `only_missing`, `import_history/statistics/calculated_stats`; screen: `filters` (form state) + `screen` (API units); prediction: `horizons[{value,unit}]`, `training{value,unit}`, `models`, `min_change_pct`, `epochs`, `reuse_forecasts`; portfolio: the RL options |
| `workflows`                     | uuid                  | `{name, description, data_criteria_id (optional, null = no import), screen_criteria_id, prediction_criteria_id, portfolio_criteria_id}` |
| `workflow_runs`                  | uuid                  | one run: criteria snapshot, `status` (queued/running/succeeded/failed/cancelled), `step`, `percent`, `message`, `steps.{data,screen,forecast,portfolio}` (counts, per-ticker forecast rows), `pool_id`, `portfolio_id`, `wall_seconds` |

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
  workflow to the most recent window to produce today's recommended
  allocation.

### Forecasting: LSTM and ARIMA

Both forecasters take the same inputs and are evaluated the same way, so
their numbers are directly comparable:

- **Same window**: the most recent `lookback_days` closes (default
  `DEFAULT_LOOKBACK_DAYS = 2515`, ~10 trading years).
- **Same test days**: `split_index()` cuts the window 80/20; both report
  one-step-ahead RMSE/MAE on exactly the last 20%.
- **Same horizon**: 84 daily steps (4 months); `horizons.py` picks the
  1/2/3/4-month points (21/42/63/84 trading days) that agreement uses.

**LSTM** (`lstm_service.py`): 1-layer PyTorch LSTM on 20-day windows
expressed relative to each window's last close (in %), so 15 years of very
different price levels share one scale. Mini-batches of 64, up to `epochs`
(default 100) with early stopping on a validation slice (patience 10, best
weights kept), fixed `seed` (default 42) → retraining is deterministic.
Recursive multi-step forecast.

**ARIMA** (`arima_service.py`, statsmodels): d = 1; (p, q) ∈ 0..3 and drift
on/off chosen by AIC on the training split (32 fits). Drift matters at
multi-month horizons — without it a d = 1 forecast flattens to a constant.
95% intervals per step.

### Signal board and refinement (`signal_service.py`)

Per ticker, four stars: fundamentals (re-runs the pool's saved screen via
`search_companies`), RL (weight > 0 in the latest portfolio with
`source_pool_id` = the pool), LSTM up at all horizons, ARIMA up at all
horizons. A horizon move within ±`DIRECTION_DEADBAND_PCT` (0.05%) is flat.
Agreement is per horizon and overall (same direction at all four). Signal:
Strong (every available star, ≥ 3 available), Avoid (both agree down), Weak
(≤ 1 star), else Mixed. Computed on read, never stored.

`POST /api/pools/<id>/refine` with `rule` `keep_strong` or `drop_weak`
creates a child pool (`iteration + 1`, same `root_pool_id`) and records why
each ticker was dropped; `GET /api/pools/<id>/lineage` returns every
iteration with its latest RL portfolio's metrics.

### Batch forecasting (`api/forecasts.py`)

`POST /api/forecasts/batch` queues one `train_lstm_prediction` and one
`train_arima_prediction` per ticker directly onto the `lstm`/`arima` queues
(no orchestrating task, so nothing blocks a worker slot) and stores the task
ids in a `forecast_runs` document. `GET /api/forecasts/batch/<id>`
aggregates the task states; the first read that sees every task done stores
`wall_seconds`. `queued` is true while a model has jobs waiting and none
running (i.e. behind another run on the same queue).

### Workflows (`workflow_service.py`, `tasks/workflow_tasks.py`)

A workflow names one screen, prediction and portfolio criteria and optionally
a data criteria; `POST /api/workflows/<id>/run` snapshots them into a
`workflow_runs` document and queues `run_workflow` on the `workflow` queue. The
task:

0. **Data** (only with a data criteria) -- `import_sp500_data` on the
   `import` queue with the criteria's options; with `only_missing` the
   tickers `get_up_to_date_tickers()` reports current are skipped (nothing
   left = no import).
1. **Screen** -- `search_companies` with the screen criteria, saved as a pool
   (`<workflow> · <date>`).
2. **Predict** -- training window = N business days, or for months/years the
   exact closes stored per ticker since that calendar date. Queues LSTM
   and/or ARIMA per ticker on the `lstm`/`arima` queues (forecast length =
   max(84, longest horizon)), skipping forecasts already trained on the same
   window of the same data when `reuse_forecasts` is on. A company passes
   when the required model(s) forecast a rise >= `min_change_pct` (or > the
   0.05% dead band) at **every** horizon. Failures are dropped via
   `refine_pool`, so the run shows up as a refinement iteration.
3. **Portfolio** -- `train_rl_portfolio` on the `rl` queue over the
   refined pool with the portfolio criteria.

It waits on its child jobs by polling their states (never `.get()` inside
a task), which is why it has its own worker -- on the lstm/arima/rl workers
it would hold the slot its children need. Progress (`percent`: data 0-25,
screen 25-28, predict 28-75, portfolio 75-100) is written to the run document every
2 s and polled by the UI. Cancel sets the Redis stop flag; the task revokes
its unfinished child jobs. A run whose task died is marked failed on read.

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
`rl_progress` / `prediction_progress` / `arima_progress` events. A DB-polling fallback
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
    predictions/                  predictionsSlice + predictionsSaga + PredictionPanel.jsx (LSTM),
                                  ForecastPanels.jsx (shared Training days), ForecastTables.jsx (horizon / next-days tables)
    arima/                        arimaSlice + arimaSaga + ArimaPanel.jsx (same pattern as predictions/)
    signals/                      SignalBoard.jsx (batch forecast + board + refine), RefinementHistory.jsx
  pages/                    ScreenerPage, PoolsPage, PortfoliosPage, PortfolioDetailPage, CompanyDetailPage, PredictionPage
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

### Docker Compose (the only supported way)

```
cp .env.example .env        # set ARANGO_PASSWORD if you want something other than "root"
docker compose up -d --build
```

That builds and starts everything in order (`arangodb` + `redis` →
`init-db` → `backend` + workers → `flower` + `frontend`). After a code
change run the same command again: it rebuilds and recreates what changed
(a `backend/` change recreates the API and every worker, since they share
the image). `docker compose logs -f backend worker-arima` to follow logs;
http://localhost:5555 (Flower) for Celery tasks.

**Worker capacity.** Each worker runs `--concurrency` processes (defaults:
import 1, rl 1, lstm 2, arima 4 — override with `IMPORT_CONCURRENCY`,
`RL_CONCURRENCY`, `LSTM_CONCURRENCY`, `ARIMA_CONCURRENCY` in `.env`), or
scale containers: `docker compose up -d --scale worker-arima=3`.

For hot-reload on React code only: with the stack running, `cd frontend &&
npm install && npm run dev` → http://localhost:5173 (talks to
`http://localhost:5000`).

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
| `IMPORT_/RL_/LSTM_/ARIMA_CONCURRENCY` | `1` / `1` / `2` / `4` | compose: processes per worker container |
| `OMP_NUM_THREADS` / `MKL_NUM_THREADS` | `1` (compose) | math threads per process (workers run several processes) |
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
| `POST /api/pools` `{name, tickers[], filters?}` | Save a candidate pool (`filters` = the screen, for the fundamentals star) |
| `POST /api/pools/<id>/refine` `{rule: keep_strong\|drop_weak}` or `{drop: []}` | Refinement loop: child pool, one iteration deeper |
| `GET /api/pools/<id>/lineage` | Every iteration of the pool's tree + latest RL portfolio metrics |
| `GET /api/pools`, `GET/DELETE /api/pools/<id>` | List/inspect/delete pools |
| `POST /api/portfolios` `{name, holdings:[{ticker,weight}], method?, notes?}` | Save a portfolio (weights auto-normalized) |
| `GET /api/portfolios`, `GET/DELETE /api/portfolios/<id>` | List/inspect/delete portfolios |
| `POST /api/rl/train` `{pool_id \| universe[], risk_aversion?, timesteps?, max_volatility?, min_return?, min_companies?, max_companies?, mode?, portfolio_name?}` | Async: train PPO, save resulting portfolio. Socket.IO event: `rl_progress` |
| `GET /api/rl/status/<task_id>` | Poll RL training status/result |
| `POST /api/data/import` `{tickers[]?, period?, interval?}` | Async: bulk Yahoo Finance -> Arango import (defaults to the full `tickers.txt` universe). Socket.IO event: `import_progress` |
| `GET /api/data/import/status/<task_id>` | Poll import status/result |
| `POST /api/predictions/train` `{ticker, lookback_days?, epochs?, seq_len?, hidden_size?}` | Async: train the LSTM (84-day forecast), store it. Socket.IO event: `prediction_progress` |
| `GET /api/predictions/status/<task_id>` | Poll prediction training status/result |
| `GET /api/predictions/<ticker>` | Most recently stored LSTM forecast for a ticker |
| `POST /api/arima/train` `{ticker, lookback_days?, order?: [p,d,q]}` | Async: fit ARIMA (84-day forecast), store it. Socket.IO event: `arima_progress` |
| `GET /api/arima/status/<task_id>`, `GET /api/arima/<ticker>` | ARIMA status / stored forecast |
| `POST /api/forecasts/batch` `{pool_id \| portfolio_id \| tickers[], lookback_days?, epochs?}` | Queue LSTM + ARIMA for every ticker; returns the run status |
| `GET /api/forecasts/batch/<run_id>`, `GET /api/forecasts/batch?pool_id=\|portfolio_id=` | Run progress (per-model counts, errors, `queued`, `wall_seconds`) / latest run |
| `POST /api/forecasts/batch/<run_id>/cancel` | Revoke the run's unfinished jobs |
| `GET /api/signals?pool_id=\|portfolio_id=` | Signal board rows + summary |
| `GET/POST /api/criteria/<kind>`, `GET/PUT/DELETE /api/criteria/<kind>/<id>`, `POST .../<id>/duplicate` | Screen / prediction / portfolio criteria CRUD (`kind` = `data`\|`screen`\|`prediction`\|`portfolio`); DELETE returns 409 while a workflow uses it |
| `GET/POST /api/workflows`, `GET/PUT/DELETE /api/workflows/<id>`, `POST .../<id>/duplicate` | Workflow CRUD (the list includes each workflow's last run) |
| `POST /api/workflows/<id>/run`, `GET /api/workflows/<id>/runs` | Start a run (409 if one is active) / run history |
| `GET /api/workflows/runs/<run_id>`, `POST /api/workflows/runs/<run_id>/cancel` | Run progress / cancel |
| `GET /api/health` | Liveness check |

## 6. Troubleshooting / operational gotchas

- **Docker Desktop crashing during builds / workers killed with signal 9**:
  causes found so far — a missing `.dockerignore` (the multi-GB local
  `backend/env` venv was sent as build context), the default CUDA PyTorch
  wheel (the Dockerfile installs the CPU build), and Celery's prefork
  default of one process per CPU core in every worker (now explicit
  `--concurrency`). If the engine itself hangs, `docker desktop restart`.
- **A forecast run never finishes**: jobs a worker had reserved when it was
  killed/recreated are only redelivered by Redis after the visibility
  timeout (1 h). Cancel the run (`POST /api/forecasts/batch/<id>/cancel`, or
  the Cancel button). Avoid recreating `worker-lstm`/`worker-arima` while a
  big run is in progress.
- **`docker compose restart backend` (or rebuilding just `backend`) makes
  the app briefly 502 through port 8080, even though `curl localhost:5000`
  works**: nginx resolves a plain `proxy_pass http://backend:5000;`
  hostname to an IP **once**, when it starts. Recreating the `backend`
  container gives it a new IP, which `frontend`'s already-running nginx
  keeps trying (and failing) until it's restarted too. `frontend` declares
  `depends_on: backend: restart: true`, so `docker compose up -d` restarts
  it automatically; if you recreate `backend` some other way, `docker
  compose restart frontend`.
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
- **New job type with its own worker**: add a route in `celery_app.py`'s
  `task_routes`, and a `worker-<name>` service in `docker-compose.yml`
  (`<<: *backend`, `-Q <name> --concurrency=...`).
- **New collection**: add it to `COLLECTIONS` in `db/arango_client.py`
  (with any indexes); `init-db` creates it on the next `docker compose up`.
