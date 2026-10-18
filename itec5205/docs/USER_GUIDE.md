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

**Workflows** automate the data import and steps 1-4: save the import, the
screen, the forecast rules and the RL options once, then run them in one
click to get a portfolio.

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
| redis, init-db, worker-import / -rl / -lstm / -arima / -workflow | (internal) | broker, one-shot DB setup, background workers |

**Open http://localhost:8080** (on Windows: `start http://localhost:8080`).
The database setup runs automatically (`init-db`).

### First use: load the data

The database starts empty. Open **Market Data** (sidebar, Data section)
and click **Start Import** to load the S&P 500 (~500
companies, price history + fundamentals from Yahoo Finance; it takes several
minutes — progress shows on the Market Data page and in the bottom bar on every
other page, and Stop/Resume work). Re-running the import refreshes the data. The page also lists
**Recent imports** (from this page, a resume or a workflow run: companies,
options, status, new price rows, duration) and **What's stored** (S&P 500
tickers imported, daily prices, history range, how many tickers are up to
date with the last trading day).

## Workflows (`/workflows`) and Criteria (`/criteria/...`)

The sidebar follows the order a workflow runs: **Data** (Market Data, Data
Criteria), **Screening** (Stock Screener, Screening Criteria, Stock Pools),
**Prediction** (Price Forecasts, Prediction Criteria), **Portfolio** (My
Portfolios, Portfolio Criteria), then **Workflows**, which runs them all (its
badge shows how many workflows are running). Pages with the sliders icon hold
saved criteria.

A **workflow** = an optional *Data Criteria* + one *Screening Criteria* + one
*Prediction Criteria* + one *Portfolio Criteria* (required fields are marked
with a red star). Each criteria is saved on its own page, in its
step of the sidebar, so several workflows can share them. Every grid has a **+**
button (new) and a **⋮** menu per row (Edit, Duplicate, Delete; workflows also
**Run** / **Cancel run**). A criteria used by a workflow can't be deleted. **⋯ → Set as default** marks one criteria per kind as the
default: new workflows start with it selected. Each criteria page shows how
many saved sets there are, which workflows use them, and the default; its
grid can be searched and sorted (Name, Used by, Updated).

- **Data Criteria** (optional) — the same options as the **Market Data** page's
  import: all S&P 500 or specific tickers, how many years of history, what to
  import, and "only what's missing". A workflow with one imports first; a
  workflow without one uses the data already stored.
- **Screening Criteria** — the same fields as the Stock Screener. The editor
  shows how many companies match today; *Copy current Stock Screener
  search* takes over whatever is filled in on the screener.
- **Prediction Criteria** — the points in time to predict (any list: 3 days,
  1 week, 1, 2, 3, 4 months, ...; in business days: week = 5, month = 21,
  year = 252), the training window (business days, or months/years of
  business days — 10 years ≈ 2515 days), which forecasts a company must pass
  (LSTM and ARIMA both up, either, or one model only), an optional minimum
  rise %, LSTM epochs, and whether to reuse forecasts already trained on the
  same data (much faster re-runs).
- **Portfolio Criteria** — the options of *Generate low-risk / high-return
  portfolio with RL*: whole pool or steady-trend only, max volatility, min
  annual return, max weight range, min/max companies, risk aversion, timesteps.

On the Workflows page, search by name or criteria and filter by each
criteria (Data also has *None*) and by last-run status; **View** opens a
workflow's last run and history.

**Running** a workflow (⋮ -> Run): (1) import with the data criteria (skipped
without one, or when everything is already up to date), (2) search with the
screen criteria, (3) forecast every match and keep the companies whose
forecasts rise at *every* point, (4) train RL on them with the portfolio
criteria. The result
is a new portfolio (plus the pools from steps 1 and 2 under Pools). The
progress bar and *Step x of 4* line show what it is waiting for; click the
workflow name for the step cards, each company's forecast at each point and
why it passed or not, and the run history.

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
**max weight range** (how much bigger the largest holding may be than the
smallest, measured in **% of the smallest** — 50 = the largest is at most
1.5× the smallest — **% of the largest** — 50 = the smallest is at least
half the largest — or **percentage points** — 10 = at most 10 points apart;
the field shows a worked example of the value you type, and the agent's
weights are moved toward equal weights just enough to fit), min/max number of
companies, risk aversion, timesteps. **Train** — progress
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

**Price Forecasts** (`/prediction`): load a ticker (or click a recent one) to
see its last close, the model signal at the chosen horizon (1M–4M:
Bullish = both models up, Bearish = both down, Mixed = they disagree; the
confidence is ARIMA's probability of a rise from its 95% interval), the
price chart with both forecasts and ARIMA's interval band, predicted prices
from 1 day to 4 months, the two models' test errors, a plain-language
interpretation, and recent predictions. **Forecast now / Re-forecast**
trains both models on the last 10 years; *Model details & settings* opens the
full training controls.

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
