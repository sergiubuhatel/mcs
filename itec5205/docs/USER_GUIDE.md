# User's Guide — S&P 500 Investment Screener & RL Portfolio Builder

This guide explains how to run the application and use it end to end from
the browser. For how the system is built internally, see
[`DEVELOPMENT_GUIDE.md`](./DEVELOPMENT_GUIDE.md).

## What this app does

The workflow from the project proposal, as one loop:

1. **Screen** S&P 500 companies by fundamentals (profitability, debt,
   valuation, growth, volatility, ...).
2. **Save a pool** of candidates from the screen.
3. **Forecast** every company in the pool with two independent models — an
   **LSTM** neural network and a classical **ARIMA** model — at 1, 2, 3 and
   4 months ahead.
4. **Allocate** with Reinforcement Learning (PPO) — a weight per company,
   optionally under a volatility ceiling / return floor / company-count limits.
5. **Combine the evidence** on the **signal board**: fundamentals, RL weight,
   LSTM direction, ARIMA direction. When all four point up, *the stars align*
   (signal **Strong**).
6. **Refine**: create a new pool without the companies whose evidence doesn't
   line up, retrain RL on it, and compare iterations.

## 1. Starting the system

From the repo root, with Docker Desktop running:

```
docker compose up -d --build
```

| Service | URL | Purpose |
|---|---|---|
| frontend | http://localhost:8080 | **The web app** |
| backend | http://localhost:5000/api | REST API + Socket.IO |
| arangodb | http://localhost:8529 | ArangoDB web UI (user `root`, password = `ARANGO_PASSWORD` in `.env`, default `root`) |
| flower | http://localhost:5555 | Celery job monitor |
| redis, init-db, worker-import / -rl / -lstm / -arima | (internal) | broker, one-shot DB setup, background workers |

**Open http://localhost:8080** (on Windows: `start http://localhost:8080`).
The database setup runs automatically (`init-db`).

### First use: load the data

The database starts empty. Click **Import** in the bottom bar to load the
S&P 500 (~500 companies, price history + fundamentals from Yahoo Finance; it
takes several minutes — progress shows in the bottom bar, and Stop/Resume
work). Re-running the import refreshes the data.

## 2. Screener (`/`)

- Filter by sector, industry, free text and min/max ranges on any indicator;
  click a column header to sort.
- Click a ticker for its **company page**.
- Tick rows and **save them as a pool**. The pool remembers the screen you
  used — that's what the *fundamentals* star re-checks later.

## 3. Pools (`/pools`)

Click a pool's name to open three panels for it.

### Signal board — do all the stars align?

- **Forecast all (LSTM + ARIMA)** queues both models for every company in the
  pool (*Training days* = how much recent history both models learn from,
  default 2515 ≈ 10 years; both are always trained on the same days). A progress
  line shows LSTM *x/n* · ARIMA *x/n*; **Cancel** stops a run. If another
  big run is ahead of yours, it shows *Waiting in queue*.
- One row per company:
  - **LSTM change / ARIMA change** at **1M, 2M, 3M, 4M** — green ▲ up, red ▼
    down, ≈ flat (within ±0.05%). Hover an ARIMA cell for P(up).
  - **Agree** per horizon: ▲▲ both up, ▼▼ both down, ≠ disagree. The models
    *agree* overall only if they agree at all four horizons.
  - **Stars** (★ yes, ☆ no, · n/a): fundamentals (still passes the pool's
    screen), RL (held by the latest RL portfolio of this pool), LSTM up at all
    horizons, ARIMA up at all horizons.
  - **Signal**: **Strong** = every available star lit · **Mixed** · **Weak**
    = at most one star · **Avoid** = both models agree on down.
- **Refine** (refinement loop): choose *Keep only Strong* or *Drop Weak &
  Avoid*, then **Refine: drop N → new pool**. A new pool "… · iteration 1" is
  created and selected — train RL on it next.

### RL portfolio

Set the limits you need (blank = none): max volatility, min annual return,
min/max number of companies, risk aversion, timesteps. **Train** — progress
streams live, and the result is saved on the Portfolios page and feeds the
RL star on the signal board.

### Refinement history

Appears once a pool has iterations: each iteration's companies, what was
dropped, and its latest RL portfolio's 1Y return / volatility / Sharpe.

## 4. Portfolios (`/portfolios`)

All saved portfolios (RL-generated and manual). A portfolio's page shows its
performance chart, holdings, allocation and its own **signal board** (Forecast
all works there too).

## 5. Company page (`/companies/<ticker>`) and Prediction page

- Price, fundamentals and a price chart (1M … ALL).
- **Training days** (shared by both models) and the last close with its
  day-over-day move.
- **LSTM** and **ARIMA** panels: predicted close at 1, 2, 3 and 4 months
  (ARIMA also with its 95% interval: a bound below the last close is red, above
  is green), test RMSE/MAE on the same held-out days for both, and **Show next
  days** for a short-term daily view (display only — not used for agreement).
- The LSTM is seeded, so retraining on the same data gives the same forecast.

## Tips

- **Screener empty** → run the Import first.
- **Forecasting looks stuck** → another run is ahead in the queue (a 500-company
  forecast takes ~15 minutes, ARIMA being the slow side); wait or **Cancel** it.
- **Signal board shows "n/a" stars** → the pool was saved without a screen
  (fundamentals) or no RL portfolio was trained on it yet (RL).
- **⚠ next to a company** → its LSTM and ARIMA forecasts were made on different
  data/windows; run Forecast all again.
- Everything lives in ArangoDB (`C:\docker-data\arangodb`), so it survives
  container restarts and rebuilds.
- Forecasts are research output, not investment advice.
