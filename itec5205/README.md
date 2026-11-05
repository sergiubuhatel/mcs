# S&P 500 Investment Screener & RL Portfolio Builder

A full-stack, data-intensive application (ITEC 5205 research project) for
screening S&P 500 companies by financial indicators, saving a candidate pool,
generating a low-risk/high-return portfolio allocation with reinforcement
learning, and forecasting individual stock prices with both an LSTM and a
classical ARIMA model — built on Flask, React/Redux-Saga, ArangoDB, and
Celery/Redis, fully Dockerized.

- **Want to use the app?** → [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md)
- **Want to understand/extend the code?** → [`docs/DEVELOPMENT_GUIDE.md`](docs/DEVELOPMENT_GUIDE.md)

## Quick start

Requires Docker Desktop (running). From the repo root:

```
docker compose up -d --build
```

That single command builds the images and starts everything in order:

1. `arangodb` and `redis`
2. `init-db` — waits for ArangoDB, creates the database, collections and
   indexes (idempotent), then exits
3. `backend` and the five Celery workers
4. `flower` and `frontend`

## Open the app in the browser

Once the containers are up (first build takes several minutes), open
**http://localhost:8080** in any browser — type it in the address bar, or
from a terminal:

```
start http://localhost:8080        # Windows (cmd / PowerShell)
open  http://localhost:8080        # macOS
xdg-open http://localhost:8080     # Linux
```

Port 8080 is the `frontend` container (nginx serving the built React app and
proxying `/api` to the backend). Check it's ready with
`curl http://localhost:8080/api/health` → `{"status":"ok"}`. If the page
doesn't load, run `docker compose ps` — every service should be `Up`
(`init-db` shows `Exited (0)`, which is expected).

On first use the database is empty: open **Market Data** in the sidebar and click
**Start Import** to load S&P 500 data, then see the User's Guide for the Screener / Pools /
Portfolios / Prediction pages.

**Frontend dev server (optional, hot reload while editing React code):**
with the Docker stack running, `cd frontend && npm install && npm run dev`,
then open **http://localhost:5173**. It talks to the backend container
directly at `http://localhost:5000`.

The ArangoDB password comes from `.env` (`ARANGO_PASSWORD`, default `root`;
see `.env.example`). ArangoDB data is bind-mounted to `C:/docker-data/arangodb`,
so it survives container rebuilds.

| Service  | URL                     |
|----------|-------------------------|
| App      | http://localhost:8080   |
| API      | http://localhost:5000/api |
| ArangoDB | http://localhost:8529 (user `root`, password from `.env`) |
| Flower (Celery monitor) | http://localhost:5555 |

## Services

| Service | Role |
|---------|------|
| `arangodb` | Database (prices, fundamentals, pools, portfolios, forecasts) |
| `redis` | Celery broker/result backend + Socket.IO message queue |
| `init-db` | One-shot: creates collections/indexes, then exits |
| `backend` | Flask REST API + Socket.IO (live job progress) |
| `worker-import` | Celery queue `import` — Yahoo Finance bulk import |
| `worker-rl` | Celery queue `rl` — PPO portfolio allocation training |
| `worker-predict` | Celery queue `predict` — LSTM price forecast training |
| `worker-arima` | Celery queue `arima` — ARIMA price forecast fitting |
| `worker-workflow` | Celery queue `workflow` — runs workflows (screen → forecast → RL portfolio) |
| `flower` | Celery monitoring UI |
| `frontend` | React app served by nginx, proxies `/api` and `/socket.io` to `backend` |

Each job type has its own worker so a long RL training run never blocks an
import or a forecast. Adding a new job type means: a task route in
`backend/app/tasks/celery_app.py` + a matching `worker-<name>` service in
`docker-compose.yml`.

## Price forecasting (LSTM and ARIMA)

On a company's detail page (or the **Prediction** page) there are two panels:

- **LSTM price forecast** — set *Epochs*, click **Train / retrain LSTM**.
- **ARIMA price forecast** — set *Lookback days* (default 2515 ≈ 10 years),
  click **Fit / refit ARIMA**. The worker tries orders (p, 1, q) for
  p, q ∈ 0..3, keeps the one with the lowest AIC, and shows a 7-day forecast
  with a 95% confidence interval.

Both report test RMSE/MAE on the same chronological 80/20 split, so the two
models can be compared directly. API equivalents:

```
POST /api/predictions/train   {"ticker": "AAPL", "epochs": 30}
POST /api/arima/train         {"ticker": "AAPL", "lookback_days": 2515}
                              # optional: "order": [p, d, q] to skip the search
GET  /api/predictions/status/<task_id>    GET /api/arima/status/<task_id>
GET  /api/predictions/<ticker>            GET /api/arima/<ticker>
```

## Common commands

```
docker compose up -d --build                 # start / update everything
docker compose ps                            # what's running
docker compose logs -f backend worker-arima  # follow logs of some services
docker compose down                          # stop everything (data kept)
```

After changing code, rerun `docker compose up -d --build` — it rebuilds and
recreates only what changed. (The backend and all workers share one image,
`itec5205-backend`, so a `backend/` change recreates all of them; `frontend`
is restarted with them so nginx picks up the new backend address.)

## Repository layout

```
backend/    Flask API + Celery tasks + RL/LSTM/ARIMA services (see DEVELOPMENT_GUIDE.md)
frontend/   React + Redux Toolkit + Redux-Saga app (Vite)
docs/       User's Guide and Development Guide
docker-compose.yml   launches the whole stack (see "Services" above)
tickers.txt          S&P 500 ticker universe used for the bulk import
fetch_stock_history.py, fetch_stock_stats.py   original standalone CSV scripts
                                                (kept for quick ad-hoc pulls; their
                                                logic was carried into
                                                backend/app/services/yahoo_import.py,
                                                which is what the app itself uses)
```

## Production (Ubuntu server) — Alpha Pilot

The app is served as **Alpha Pilot** at https://itec5205.ganymedesoftware.ca from the Ubuntu server
`sergiu@192.168.2.202`, folder `/opt/ganymede/alpha-pilot` (images and configuration only: no source code,
no Git). This Windows PC is for development only (http://localhost:8080, empty `CLOUDFLARE_TUNNEL_TOKEN` in
`.env`). Never start the `tunnel` profile here.

**Deploy** from Command Prompt: `C:\development\mcs\itec5205\deploy\deploy.cmd`. It builds `itec5205-backend`
(API and all workers) and `itec5205-frontend`, copies them with `docker-compose.yml`, the ticker lists,
`keycloak/` and `deploy/` to the server, then `deploy/install.sh` loads them, restarts the app and checks
`/api/health`. The server's `.env`, database, models and Keycloak data are never touched.

On the server:

- `.env`: production settings, plus `COMPOSE_PROJECT_NAME=itec5205`,
  `COMPOSE_FILE=docker-compose.yml:deploy/docker-compose.server.yml` and `COMPOSE_PROFILES=tunnel`.
- `deploy/docker-compose.server.yml`: ArangoDB in a Docker volume (not `C:/docker-data`), the database,
  Redis, API, Flower and Keycloak ports only on the server itself, and `host.docker.internal` for the
  tunnel's `listings.ganymedesoftware.ca` route (Ontario Homes on port 3000).
- `alpha-pilot.service` starts the app at boot (`sudo systemctl restart alpha-pilot`).
