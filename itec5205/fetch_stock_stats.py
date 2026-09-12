"""Pull current key statistics for a list of stocks from Yahoo Finance and
write them all into a single combined CSV.

Usage:
    python fetch_stock_stats.py tickers.txt output/stock_stats.csv
"""

import argparse
import sys
from pathlib import Path

import pandas as pd
import yfinance as yf

DEFAULT_TICKERS = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"]

# Yahoo Finance "info" fields to pull, in output column order.
STAT_FIELDS = {
    "company": "longName",
    "sector": "sector",
    "industry": "industry",
    "current_price": "currentPrice",
    "previous_close": "previousClose",
    "open": "open",
    "day_low": "dayLow",
    "day_high": "dayHigh",
    "fifty_two_week_low": "fiftyTwoWeekLow",
    "fifty_two_week_high": "fiftyTwoWeekHigh",
    "volume": "volume",
    "average_volume": "averageVolume",
    "market_cap": "marketCap",
    "beta": "beta",
    "trailing_pe": "trailingPE",
    "forward_pe": "forwardPE",
    "eps_trailing": "trailingEps",
    "eps_forward": "forwardEps",
    "dividend_yield": "dividendYield",
    "dividend_rate": "dividendRate",
    "payout_ratio": "payoutRatio",
    "book_value": "bookValue",
    "price_to_book": "priceToBook",
    "shares_outstanding": "sharesOutstanding",
    "fifty_day_average": "fiftyDayAverage",
    "two_hundred_day_average": "twoHundredDayAverage",
}


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


def fetch_ticker_stats(ticker: str) -> dict:
    info = yf.Ticker(ticker).info
    if not info or info.get("regularMarketPrice") is None and info.get("currentPrice") is None:
        raise ValueError(f"No statistics returned for ticker '{ticker}'")

    row = {"ticker": ticker}
    for column, field in STAT_FIELDS.items():
        row[column] = info.get(field)
    return row


def main():
    parser = argparse.ArgumentParser(description="Fetch current stock statistics from Yahoo Finance")
    parser.add_argument("input", help="Input file with one ticker per line (created with default tickers if it doesn't exist)")
    parser.add_argument("output", help="Combined output CSV file, e.g. output/stock_stats.csv (parent directory created automatically)")
    args = parser.parse_args()

    input_path = Path(args.input)
    ensure_input_file(input_path)
    tickers = read_tickers(input_path)

    rows = []
    for ticker in tickers:
        try:
            rows.append(fetch_ticker_stats(ticker))
            print(f"[{ticker}] fetched statistics")
        except Exception as exc:
            print(f"[{ticker}] failed: {exc}", file=sys.stderr)

    if not rows:
        print("No statistics fetched for any ticker.", file=sys.stderr)
        sys.exit(1)

    combined = pd.DataFrame(rows)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    combined.to_csv(output_path, index=False)
    print(f"Saved statistics for {len(combined)} ticker(s) to {output_path}")


if __name__ == "__main__":
    main()
