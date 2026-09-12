# Stock data tools

Two standalone scripts for pulling Yahoo Finance data for a list of stock
tickers into a single combined CSV file.

- `fetch_stock_history.py` — 1 year of historical daily closing prices
- `fetch_stock_stats.py` — current key statistics (price, market cap, P/E, etc.)

## Setup

```
pip install -r requirements.txt
```

## Input file

Both scripts take an input file as their first positional argument: a plain
text file listing tickers, one per line (`#` lines are treated as comments
and ignored).

If the input file doesn't exist yet, it is created automatically with the
default tickers — the "Magnificent 7": **AAPL, MSFT, GOOGL, AMZN, NVDA, META,
TSLA**.

Example `tickers.txt`:

```
AAPL
MSFT
GOOGL
AMZN
NVDA
META
TSLA
```

---

## fetch_stock_history.py

Pulls 1 year of historical daily closing prices for each ticker and writes
them all into a single combined CSV.

### Usage

Input and output files are both required positional arguments:

```
python fetch_stock_history.py <input> <output> [--period PERIOD] [--interval INTERVAL]
```

```
python fetch_stock_history.py tickers.txt output/stock_history.csv
```

Use a different input file (created with the default tickers if it doesn't
exist yet):

```
python fetch_stock_history.py my_tickers.txt output/my_history.csv
```

Change the time period or interval:

```
python fetch_stock_history.py tickers.txt output/stock_history.csv --period 6mo --interval 1wk
```

### Options

| Argument     | Default      | Description                                                |
|--------------|--------------|--------------------------------------------------------------|
| `input`      | *(required)* | Input file with one ticker per line                          |
| `output`     | *(required)* | Combined output CSV file (parent directory created automatically) |
| `--period`   | `1y`         | History window, e.g. `1mo`, `6mo`, `1y`, `5y`, `max`         |
| `--interval` | `1d`         | Data granularity, e.g. `1d`, `1wk`, `1mo`                    |

### Output columns

| Column               | Description                          |
|----------------------|---------------------------------------|
| `ticker`             | Ticker symbol, e.g. `AAPL`            |
| `company`            | Company name, e.g. `Apple Inc.`       |
| `date`               | Trading date                          |
| `close`              | End-of-day close, or current live price if today's session hasn't closed yet (2 decimals) |
| `previous`           | Previous row's `close` (2 decimals; blank for the first row) |
| `value_change`       | `close - previous` (2 decimals; can be negative) |
| `percentage_change`  | `(close - previous) / previous * 100` (2 decimals; can be negative) |

---

## fetch_stock_stats.py

Pulls current key statistics for each ticker (price, market cap, valuation
ratios, 52-week range, etc.) and writes them all into a single combined CSV.

### Usage

Input and output files are both required positional arguments:

```
python fetch_stock_stats.py <input> <output>
```

```
python fetch_stock_stats.py tickers.txt output/stock_stats.csv
```

### Options

| Argument | Default      | Description                                                |
|----------|--------------|--------------------------------------------------------------|
| `input`  | *(required)* | Input file with one ticker per line                          |
| `output` | *(required)* | Combined output CSV file (parent directory created automatically) |

### Output columns

| Column                     | Description                          |
|-----------------------------|---------------------------------------|
| `ticker`                    | Ticker symbol                         |
| `company`                   | Company name                          |
| `sector`                    | GICS sector                           |
| `industry`                  | GICS industry                         |
| `current_price`             | Latest traded price                   |
| `previous_close`            | Previous session's close              |
| `open`                      | Today's open price                    |
| `day_low` / `day_high`      | Today's price range                   |
| `fifty_two_week_low/high`   | 52-week price range                   |
| `volume`                    | Today's trading volume                |
| `average_volume`            | Average daily trading volume          |
| `market_cap`                | Market capitalization                 |
| `beta`                      | Beta (volatility vs. market)          |
| `trailing_pe` / `forward_pe`| Trailing / forward P/E ratio          |
| `eps_trailing` / `eps_forward` | Trailing / forward EPS             |
| `dividend_yield`            | Dividend yield                        |
| `dividend_rate`             | Annual dividend rate                  |
| `payout_ratio`              | Dividend payout ratio                 |
| `book_value`                | Book value per share                  |
| `price_to_book`             | Price-to-book ratio                   |
| `shares_outstanding`        | Shares outstanding                    |
| `fifty_day_average`         | 50-day moving average price           |
| `two_hundred_day_average`   | 200-day moving average price          |

---

## Errors

If a ticker is invalid or Yahoo Finance returns no data, an error is printed
to stderr and the script continues with the remaining tickers.

`close` is the end-of-day price once the market has closed for that day; for
the current day, if the session hasn't closed yet, `fetch_stock_history.py`
fills it in with the current live price instead (a message is printed). If
Yahoo's history omits today's row entirely (common while the session is
still open), a row for today is added using the current live price. Rows
with no valid close and no live price available are dropped, with a warning.
