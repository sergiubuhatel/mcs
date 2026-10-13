"""Refresh ``russell3000.txt`` (repo root) from the iShares Russell 3000 ETF
(IWV) holdings file -- the index itself isn't published as a free list, the
ETF that tracks it is.

Keeps equities with a real listing, and rewrites share classes the way
Yahoo Finance spells them ("BRK B" -> "BRK-B").

Usage (from the repo root):
    python backend/scripts/update_russell3000.py
"""

import csv
import io
import os
import urllib.request

URL = "https://www.ishares.com/us/products/239714/ishares-russell-3000-etf/latest-holdings.csv"
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "russell3000.txt")
UNLISTED = "NO MARKET (E.G. UNLISTED)"


def main():
    req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0"})
    text = urllib.request.urlopen(req, timeout=60).read().decode("utf-8-sig")
    lines = text.splitlines()
    as_of = next((l.split(",", 1)[1].strip('"') for l in lines if l.startswith("Fund Holdings as of")), "?")
    start = next(i for i, l in enumerate(lines) if l.startswith("Ticker,"))
    tickers = []
    for row in csv.DictReader(io.StringIO("\n".join(lines[start:]))):
        ticker = (row.get("Ticker") or "").strip()
        if row.get("Asset Class") != "Equity" or row.get("Exchange") == UNLISTED:
            continue
        ticker = ticker.replace(" ", "-")
        if not ticker.replace("-", "").isalnum() or ticker.count("-") > 1:
            continue  # "-" placeholders, rights/warrants like UWMC-R-W
        tickers.append(ticker.upper())
    tickers = sorted(dict.fromkeys(tickers))
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write(f"# Russell 3000 constituents, from iShares IWV holdings as of {as_of}\n")
        fh.write("# Refresh: python backend/scripts/update_russell3000.py\n")
        fh.write("\n".join(tickers) + "\n")
    print(f"{len(tickers)} tickers (as of {as_of}) -> {os.path.abspath(OUT)}")


if __name__ == "__main__":
    main()
