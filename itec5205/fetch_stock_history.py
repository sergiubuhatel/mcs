"""Pull 1 year of historical daily close-price data for a list of stocks
from Yahoo Finance and write them all into a single combined CSV.

Usage:
    python fetch_stock_history.py
    python fetch_stock_history.py --input tickers.txt --output stock_history.csv
"""

import argparse
import sys
from pathlib import Path

import pandas as pd
import yfinance as yf

DEFAULT_TICKERS = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"]


def ensure_input_file(input_path: Path):
    """Create the input file with default tickers if it doesn't exist yet."""
    if not input_path.exists():
        input_path.write_text("\n".join(DEFAULT_TICKERS) + "\n", encoding="utf-8")
        print(f"Created default input file at {input_path} with: {', '.join(DEFAULT_TICKERS)}")


def read_tickers(input_path: Path):
    tickers = []
    for line in input_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            tickers.append(line.upper())
    if not tickers:
        raise ValueError(f"No tickers found in {input_path}")
    return tickers


def fetch_ticker_data(ticker: str, period: str, interval: str) -> pd.DataFrame:
    yf_ticker = yf.Ticker(ticker)

    history = yf_ticker.history(period=period, interval=interval)
    if history.empty:
        raise ValueError(f"No data returned for ticker '{ticker}'")

    try:
        info = yf_ticker.info
    except Exception:
        info = {}

    company = info.get("longName") or info.get("shortName") or ticker
    current_price = info.get("currentPrice") or info.get("regularMarketPrice")

    # "close" = the end-of-day price once the market has closed for that day,
    # or the current live price if today's session hasn't closed yet.
    close = pd.to_numeric(history["Close"], errors="coerce")
    missing = close.isna()
    if missing.any():
        if current_price is not None:
            close = close.copy()
            close[missing] = current_price
            print(f"[{ticker}] filled {missing.sum()} row(s) with the current live price (session not yet closed)")
        else:
            print(f"[{ticker}] dropping {missing.sum()} row(s) with no valid close and no live price available")

    df = pd.DataFrame({
        "ticker": ticker,
        "company": company,
        "date": history.index.tz_localize(None),
        "close": close.round(2).values,
    })
    df = df.dropna(subset=["close"])

    # Yahoo's daily history sometimes omits today's row entirely until the
    # session closes. If that happened, add it using the current live price.
    today = pd.Timestamp.now().normalize()
    if current_price is not None and not (df["date"] == today).any():
        df = pd.concat([df, pd.DataFrame([{
            "ticker": ticker,
            "company": company,
            "date": today,
            "close": round(current_price, 2),
        }])], ignore_index=True)
        print(f"[{ticker}] added today's row using the current live price (missing from Yahoo history)")

    df = df.sort_values("date").reset_index(drop=True)
    df["previous"] = df["close"].shift(1).round(2)
    df["value_change"] = (df["close"] - df["previous"]).round(2)
    df["percentage_change"] = ((df["close"] - df["previous"]) / df["previous"] * 100).round(2)

    return df


def main():
    parser = argparse.ArgumentParser(description="Fetch 1-year historical stock data from Yahoo Finance")
    parser.add_argument("input", help="Input file with one ticker per line (created with default tickers if it doesn't exist)")
    parser.add_argument("output", help="Combined output CSV file, e.g. output/stock_history.csv (parent directory created automatically)")
    parser.add_argument("--period", default="1y", help="History period (default: 1y)")
    parser.add_argument("--interval", default="1d", help="Data interval, e.g. 1d, 1wk, 1mo (default: 1d)")
    args = parser.parse_args()

    input_path = Path(args.input)
    ensure_input_file(input_path)
    tickers = read_tickers(input_path)

    frames = []
    for ticker in tickers:
        try:
            frames.append(fetch_ticker_data(ticker, args.period, args.interval))
            print(f"[{ticker}] fetched {len(frames[-1])} rows")
        except Exception as exc:
            print(f"[{ticker}] failed: {exc}", file=sys.stderr)

    if not frames:
        print("No data fetched for any ticker.", file=sys.stderr)
        sys.exit(1)

    combined = pd.concat(frames, ignore_index=True)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    combined.to_csv(output_path, index=False)
    print(f"Saved {len(combined)} rows for {len(frames)} ticker(s) to {output_path}")


if __name__ == "__main__":
    main()
