"""Read a brokerage positions screenshot (OCR) into tickers + weights.

Built for a Canadian account holding US stocks: the statement shows each
position's market value in CAD, but only the SHARES of the total matter for a
portfolio, so the currency cancels out. Tesseract reads the words with their
positions; words are grouped into rows by height on the page (so it does not
matter how Tesseract splits the table into blocks), and a row is a position
when it starts with a ticker and ends with a percentage.

Columns are found by arithmetic rather than by header text, so other brokers'
layouts with the same idea also work: in "... book value, market price, market
value, change ($), change (%)" the market value is the number for which
`market value - book value = change`. A row where that check fails is still
returned, flagged, for the user to correct in the review table.
"""

import io
import re
import statistics

from PIL import Image, ImageOps
import pytesseract

from ..db.arango_client import get_db

MAX_IMAGE_BYTES = 15 * 1024 * 1024
MIN_OCR_WIDTH = 2400  # Tesseract reads small screenshot text better upscaled

TICKER_RE = re.compile(r"^[A-Z]{1,5}(?:[.\-][A-Z]{1,2})?$")
NUMBER_RE = re.compile(r"[-+]?\$?\d[\d,]*(?:\.\d+)?")
PERCENT_RE = re.compile(r"[-+]?\d[\d,]*(?:\.\d+)?%")
CURRENCY_RE = re.compile(r"\((CAD|USD)\)")
NOT_TICKERS = {"CAD", "USD", "TOTAL", "SYMBOL", "CASH"}


def _to_float(text: str) -> float | None:
    try:
        return float(text.replace("$", "").replace(",", ""))
    except ValueError:
        return None


def _ocr_lines(image: Image.Image) -> list[list[dict]]:
    """Words grouped into visual rows, each row sorted left to right."""
    image = ImageOps.exif_transpose(image).convert("L")
    if image.width < MIN_OCR_WIDTH:
        scale = MIN_OCR_WIDTH / image.width
        image = image.resize((MIN_OCR_WIDTH, round(image.height * scale)), Image.LANCZOS)

    data = pytesseract.image_to_data(image, config="--psm 6", output_type=pytesseract.Output.DICT)
    words = [
        {"text": t.strip(), "x": data["left"][i], "y": data["top"][i] + data["height"][i] / 2, "h": data["height"][i]}
        for i, t in enumerate(data["text"])
        if t.strip()
    ]
    if not words:
        return []

    tolerance = statistics.median(w["h"] for w in words) * 0.6
    lines: list[list[dict]] = []
    for word in sorted(words, key=lambda w: w["y"]):
        if lines and abs(word["y"] - statistics.fmean(w["y"] for w in lines[-1])) <= tolerance:
            lines[-1].append(word)
        else:
            lines.append([word])
    return [sorted(line, key=lambda w: w["x"]) for line in lines]


def _market_value(nums: list[float]) -> tuple[float | None, bool]:
    """(market value, passed the book + change check) from a row's numbers,
    percentages already removed. Prefers the layout `..., book, price, value,
    change`, then any value/book/change triple that adds up."""
    def adds_up(value, book, change):
        return abs(value - book - change) <= 0.02 + abs(value) * 0.0005

    if len(nums) >= 4 and adds_up(nums[-2], nums[-4], nums[-1]):
        return nums[-2], True
    for i in range(len(nums) - 1):
        for j in range(i):
            if adds_up(nums[i], nums[j], nums[i + 1]):
                return nums[i], True
    if len(nums) >= 2:
        return nums[-2], False
    return (nums[0], False) if nums else (None, False)


def parse_lines(lines: list[list[dict]]) -> dict:
    positions, total, currency, cash, account_total = [], None, None, None, None
    after_total_label = False
    for line in lines:
        texts = [w["text"] for w in line]
        joined = " ".join(texts)
        if currency is None and (m := CURRENCY_RE.search(joined)):
            currency = m.group(1)

        percent = PERCENT_RE.search(joined)
        # Numbers outside the percentage; a token like "1,730.52A" (an arrow
        # icon read as a letter) still yields its number.
        found = [
            (i, n)
            for i, t in enumerate(texts)
            if not PERCENT_RE.search(t)
            for n in (_to_float(m) for m in NUMBER_RE.findall(t))
            if n is not None
        ]
        nums = [n for _, n in found]

        # Account summary "CAD  total value  market value ...": the cash is
        # the difference (the funds not invested in stocks).
        if cash is None and texts[0] in ("CAD", "USD") and len(nums) >= 2 and not percent:
            if 0 <= nums[0] - nums[1] < nums[0]:
                cash, currency = round(nums[0] - nums[1], 2), currency or texts[0]
            continue

        # "Total market value  $210,669.46 CAD" under the table = stocks +
        # cash; the amount can be on the line below the label.
        if after_total_label and nums and account_total is None:
            account_total = nums[0]
        after_total_label = "TOTAL MARKET VALUE" in joined.upper()
        if after_total_label:
            if nums:
                account_total = nums[-1]
            continue

        if "TOTAL" in joined.upper() and len(nums) >= 2:
            total, _ = _market_value(nums)
            continue

        ticker = texts[0].strip(".,:;|")
        if not (TICKER_RE.match(ticker) and ticker not in NOT_TICKERS and percent and len(nums) >= 2):
            continue

        value, checked = _market_value(nums)
        if value is None or value <= 0:
            continue
        # quantity, avg cost, book, price, value, change: the quantity is six
        # from the end, so a number in the name ("PHILLIPS 66") is skipped.
        quantity_at = len(found) - 6 if len(found) >= 6 else None
        name_end = found[quantity_at][0] if quantity_at is not None else next((i for i, _ in found if i > 0), len(texts))
        positions.append({
            "ticker": ticker,
            "security": " ".join(texts[1:name_end]).replace("…", "").strip(" .") or None,
            "quantity": found[quantity_at][1] if quantity_at is not None else None,
            "market_value": round(value, 2),
            "checked": checked,
            # Positions priced in USD are the NYSE/NASDAQ listings; a row with
            # no USD at all (e.g. a TSX-V namesake) is likely something else.
            "usd": "USD" in texts,
            "raw": joined,
        })
    if cash is None and account_total and total and account_total >= total:
        cash = round(account_total - total, 2)
    return {"positions": positions, "statement_total": total, "currency": currency, "cash": cash}


def _company_names(tickers: list[str]) -> dict:
    cursor = get_db().aql.execute(
        "FOR c IN companies FILTER c._key IN @tickers RETURN {ticker: c._key, name: c.name}",
        bind_vars={"tickers": tickers},
    )
    return {c["ticker"]: c["name"] for c in cursor}


def _first_word(name: str | None) -> str:
    words = re.findall(r"[A-Z0-9]+", (name or "").upper())
    return words[0] if words else ""


def _one_letter_apart(a: str, b: str) -> bool:
    if len(a) == len(b):
        return sum(x != y for x, y in zip(a, b)) == 1
    short, long_ = sorted((a, b), key=len)
    return len(long_) - len(short) == 1 and any(long_[:i] + long_[i + 1:] == short for i in range(len(long_)))


def _correct_misread(position: dict) -> str | None:
    """An unknown ticker one letter away from a stored company whose name
    starts like the statement's security name (OCR read FTNT as FINT) -> that
    ticker; None when there is no single such company."""
    word = _first_word(position["security"])
    if len(word) < 3:
        return None
    cursor = get_db().aql.execute(
        "FOR c IN companies FILTER LIKE(UPPER(c.name), @prefix) RETURN {ticker: c._key, name: c.name}",
        bind_vars={"prefix": f"{word[:3]}%"},
    )
    matches = [c["ticker"] for c in cursor if _first_word(c["name"]) == word and _one_letter_apart(c["ticker"], position["ticker"])]
    return matches[0] if len(matches) == 1 else None


def read_statement(image_bytes: bytes) -> dict:
    """OCR + parse an uploaded image. Rows keep the statement's order; each
    says whether the ticker is in the database (prices exist for metrics)."""
    try:
        image = Image.open(io.BytesIO(image_bytes))
        image.load()
    except Exception as exc:
        raise ValueError("The file is not an image that can be read (PNG, JPG, …)") from exc

    result = parse_lines(_ocr_lines(image))
    if not result["positions"]:
        raise ValueError("No positions found in the image -- use a screenshot of the positions table (symbol … market value … change %)")

    names = _company_names(sorted({p["ticker"] for p in result["positions"]}))
    for p in result["positions"]:
        if p["ticker"] not in names and (fixed := _correct_misread(p)):
            p["read_as"], p["ticker"] = p["ticker"], fixed
            names.update(_company_names([fixed]))
    for p in result["positions"]:
        p["company"] = names.get(p["ticker"])
        p["known"] = p["ticker"] in names
    result["rows_total"] = round(sum(p["market_value"] for p in result["positions"]), 2)
    return result
