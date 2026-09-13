# User's Guide — S&P 500 Investment Screener & RL Portfolio Builder

This guide explains how to run the application and how to use it, end to
end, from the browser. For how the system is built internally, see
[`DEVELOPMENT_GUIDE.md`](./DEVELOPMENT_GUIDE.md). For the academic writeup,
see [`paper/ITEC5205_ResearchPaper.docx`](../paper/ITEC5205_ResearchPaper.docx).

## What this app does

1. **Search** S&P 500 companies by profitability, debt, valuation (P/E),
   market cap, sector/industry, and other fundamentals.
2. **Save a pool** of candidate tickers from your search results.
3. **Generate a portfolio with Reinforcement Learning** — trains a PPO
   agent on a pool's historical returns and recommends a low-risk /
   high-return allocation (a weight percentage per stock).
4. **Predict individual stock prices** a week ahead with an LSTM model,
   per ticker.
5. **Save and compare portfolios** — both RL-generated and manually built.

## 1. Starting the system

From the repo root, with Docker Desktop running:

```
docker compose up -d --build
```

This starts six containers:

| Service    | URL                          | Purpose                                  |
|------------|-------------------------------|-------------------------------------------|
| frontend   | http://localhost:8080         | The web app (React)                       |
| backend    | http://localhost:5000/api     | REST API + Socket.IO (used directly only if you're not going through the frontend proxy) |
| arangodb   | http://localhost:8529          | ArangoDB web UI (inspect the raw data)    |
| flower     | http://localhost:5555          | Celery task monitor (see running jobs)    |
| redis      | (internal only)               | Celery broker / Socket.IO message bus     |
| worker     | (internal only)               | Runs import/RL/LSTM jobs in the background|

**Open the app at http://localhost:8080.**

### ArangoDB login

The ArangoDB web UI (http://localhost:8529) logs in with:

- **Username:** `root`
- **Password:** the value of `ARANGO_PASSWORD` in your `.env` file at the
  repo root (defaults to `root` if you copied `.env.example` as-is).

Use the ArangoDB UI's "investing" database to browse collections directly
(`companies`, `stock_prices`, `stock_stats`, `financial_ratios`, `sectors`,
`industries`, `pools`, `portfolios`, `rl_runs`, `price_predictions`) if you
want to see the raw documents behind the screener.

### First-time setup: load the data

The database starts empty. Before the Screener shows anything:

1. Run the one-off schema setup (only needed once):
   ```
   docker compose exec backend python scripts/init_db.py
   ```
2. Trigger a data import. From the app, this isn't (yet) a button in the
   UI — kick it off via the API once:
   ```
   curl -X POST http://localhost:8080/api/data/import -H "Content-Type: application/json" -d "{}"
   ```
   With no `tickers` given, it imports the full S&P 500 list from
   `tickers.txt` (~500 companies; takes on the order of 10–20 minutes,
   since Yahoo Finance is queried a few times per ticker). Watch progress
   in Flower (http://localhost:5555) or by polling the returned
   `task_id` at `/api/data/import/status/<task_id>`.
   - To import a handful of tickers quickly instead (for a fast demo),
     pass an explicit list: `{"tickers": ["AAPL","MSFT","NVDA"]}`.

Re-running the import later refreshes prices/stats/ratios for the same
tickers (it upserts, so it's safe to re-run).

## 2. Screener page (`/`)

- Use the filter form to narrow by **sector**, **industry**, free-text
  search, and min/max ranges on market cap, P/E, ROE, ROA, debt-to-equity,
  current ratio, gross/net margin, dividend yield.
- Click a column header to sort by it (click again to flip direction).
- Click a ticker to open its **Company Detail** page (price chart,
  fundamentals, and the LSTM price forecast panel).
- Check the box next to any rows you're interested in, then name and
  **save them as a pool** at the top of the results — this pool becomes
  the candidate universe for RL portfolio generation.

## 3. Pools page (`/pools`)

- Lists every pool you've saved from the Screener.
- Click a pool's name to open the **RL training panel** for it:
  - **Risk aversion**: higher values push the agent toward lower
    volatility even if it costs some expected return (it's the λ in
    `reward = return − λ × volatility`).
  - **Training timesteps**: how long to train the PPO agent. A few
    thousand is enough for a quick look; tens of thousands gives a more
    settled policy but takes longer.
  - Click **Train RL portfolio**. Progress streams live (over
    WebSockets) as a progress bar; when done, you'll see the recommended
    **weight percentage per ticker**, plus the resulting portfolio's
    estimated annual **return, volatility, and Sharpe ratio** (computed
    from the pool's own historical daily returns). It's automatically
    saved to the Portfolios page.

## 4. Portfolios page (`/portfolios`)

- Shows every saved portfolio (both RL-generated and manual), each with
  its holdings (ticker + weight %) and estimated return/volatility/Sharpe.
- You can also build a portfolio **manually**: add ticker/weight rows and
  save — weights don't need to sum to 1, they're normalized automatically.
- Delete any portfolio you no longer want.

## 5. Company Detail page (`/companies/<ticker>`)

- Key stats (price, market cap, P/E, beta) and fundamentals (ROE, ROA,
  debt-to-equity, current ratio, margins, revenue growth).
- A price history chart (up to 2 years, depending on what was imported).
- **LSTM price forecast panel**: click "Train / retrain LSTM" to fit a
  small neural network to that ticker's price history and get a 7-trading-day
  forecast, along with the model's held-out test RMSE/MAE (a smaller number
  means a tighter fit — treat forecasts as illustrative, not investment advice).

## Tips

- **Nothing shows up in the Screener** → you haven't run the import yet,
  or it's still running. Check Flower or the import status endpoint.
- **RL/LSTM training feels slow** → lower `timesteps`/`epochs` for a quick
  look; the trade-off is a less-refined result.
- **A pool needs at least 2 tickers with enough price history** — a
  freshly imported ticker only has as much history as the import's
  `period` argument requested (default 2 years).
- Everything (pools, portfolios, prediction results) lives in ArangoDB, so
  it survives restarting the containers — only `docker compose down -v`
  (which deletes volumes) or wiping the `C:\docker-data\arangodb` folder
  clears it.
