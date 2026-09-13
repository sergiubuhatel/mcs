# S&P 500 Investment Screener & RL Portfolio Builder

A full-stack, data-intensive application (ITEC 5205 individual research
project) for screening S&P 500 companies by financial indicators, saving a
candidate pool, generating a low-risk/high-return portfolio allocation with
reinforcement learning, and forecasting individual stock prices with an
LSTM — built on Flask, React/Redux-Saga, ArangoDB, and Celery/Redis, fully
Dockerized.

- **Want to use the app?** → [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md)
- **Want to understand/extend the code?** → [`docs/DEVELOPMENT_GUIDE.md`](docs/DEVELOPMENT_GUIDE.md)
- **The academic writeup** → [`paper/ITEC5205_ResearchPaper.docx`](paper/ITEC5205_ResearchPaper.docx)

## Quick start

```
docker compose up -d --build
docker compose exec backend python scripts/init_db.py
```

Then open **http://localhost:8080** and see the User's Guide for loading
data and using the Screener / Pools / Portfolios pages.

| Service  | URL                     |
|----------|-------------------------|
| App      | http://localhost:8080   |
| API      | http://localhost:5000/api |
| ArangoDB | http://localhost:8529 (user `root`, password in `.env`) |
| Flower (Celery monitor) | http://localhost:5555 |

## Repository layout

```
backend/    Flask API + Celery tasks + RL/LSTM services (see DEVELOPMENT_GUIDE.md)
frontend/   React + Redux Toolkit + Redux-Saga app (Vite)
paper/      IEEE-style research paper (build_paper.py regenerates the .docx)
docs/       User's Guide and Development Guide
docker-compose.yml   launches arangodb, redis, backend, worker, flower, frontend
tickers.txt          S&P 500 ticker universe used for the bulk import
fetch_stock_history.py, fetch_stock_stats.py   original standalone CSV scripts
                                                (kept for quick ad-hoc pulls; their
                                                logic was carried into
                                                backend/app/services/yahoo_import.py,
                                                which is what the app itself uses)
```
