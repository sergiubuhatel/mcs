"""Search/filter/sort companies by valuation, profitability, and debt
indicators, backed by a single AQL query joining companies + stock_stats +
financial_ratios.
"""

from ..db.arango_client import get_db

# Whitelisted sortable fields -> which merged-document attribute they map to.
# Only whitelisted values are ever interpolated into the AQL string, so this
# stays injection-safe even though sort direction/field can't be bind params
# (AQL doesn't allow ASC/DESC or attribute names to be bind parameters).
SORTABLE_FIELDS = {
    "ticker": "company._key",
    "market_cap": "stats.market_cap",
    "trailing_pe": "stats.trailing_pe",
    "forward_pe": "stats.forward_pe",
    "dividend_yield": "stats.dividend_yield",
    "price_to_book": "stats.price_to_book",
    "beta": "stats.beta",
    "current_price": "stats.current_price",
    "roe": "ratios.roe",
    "roa": "ratios.roa",
    "debt_to_equity": "ratios.debt_to_equity",
    "current_ratio": "ratios.current_ratio",
    "gross_margin": "ratios.gross_margin",
    "operating_margin": "ratios.operating_margin",
    "net_margin": "ratios.net_margin",
    "revenue_growth_yoy": "ratios.revenue_growth_yoy",
    "name": "company.name",
    "sector": "company.sector",
}

# Fields that aren't a single stored attribute but a computed expression --
# e.g. day-over-day change isn't stored, it's derived from two stats fields.
COMPUTED_SORT_EXPRESSIONS = {
    "day_change": "(stats.previous_close == null || stats.previous_close == 0) ? null : "
    "(stats.current_price - stats.previous_close) / stats.previous_close",
}

FILTERABLE_RANGES = {
    "market_cap": "stats.market_cap",
    "trailing_pe": "stats.trailing_pe",
    "price_to_book": "stats.price_to_book",
    "dividend_yield": "stats.dividend_yield",
    "beta": "stats.beta",
    "roe": "ratios.roe",
    "roa": "ratios.roa",
    "debt_to_equity": "ratios.debt_to_equity",
    "current_ratio": "ratios.current_ratio",
    "gross_margin": "ratios.gross_margin",
    "operating_margin": "ratios.operating_margin",
    "net_margin": "ratios.net_margin",
    "revenue_growth_yoy": "ratios.revenue_growth_yoy",
}


def search_companies(
    sector: str | None = None,
    industry: str | None = None,
    query: str | None = None,
    ranges: dict[str, tuple[float | None, float | None]] | None = None,
    sort_by: str = "market_cap",
    sort_dir: str = "desc",
    limit: int = 50,
    offset: int = 0,
) -> dict:
    """Filter/sort/paginate the company universe.

    ``ranges`` maps a key from FILTERABLE_RANGES to a (min, max) tuple; either
    side may be None to leave that bound open.
    """
    db = get_db()

    sort_field = COMPUTED_SORT_EXPRESSIONS.get(sort_by) or SORTABLE_FIELDS.get(sort_by, SORTABLE_FIELDS["market_cap"])
    sort_dir = "DESC" if str(sort_dir).lower() == "desc" else "ASC"

    filter_clauses = ["stats != null"]
    bind_vars: dict = {"limit": limit, "offset": offset}

    if sector:
        filter_clauses.append("company.sector == @sector")
        bind_vars["sector"] = sector
    if industry:
        filter_clauses.append("company.industry == @industry")
        bind_vars["industry"] = industry
    if query:
        filter_clauses.append("(CONTAINS(UPPER(company.name), UPPER(@query)) OR CONTAINS(UPPER(company._key), UPPER(@query)))")
        bind_vars["query"] = query

    for key, (lo, hi) in (ranges or {}).items():
        path = FILTERABLE_RANGES.get(key)
        if not path:
            continue
        if lo is not None:
            var = f"{key}_min"
            filter_clauses.append(f"{path} >= @{var}")
            bind_vars[var] = lo
        if hi is not None:
            var = f"{key}_max"
            filter_clauses.append(f"{path} <= @{var}")
            bind_vars[var] = hi

    filter_expr = " AND ".join(filter_clauses)

    aql = f"""
        FOR company IN companies
            LET stats = DOCUMENT('stock_stats', company._key)
            LET ratios = DOCUMENT('financial_ratios', company._key)
            FILTER {filter_expr}
            SORT {sort_field} {sort_dir}
            LIMIT @offset, @limit
            RETURN {{
                ticker: company._key,
                name: company.name,
                sector: company.sector,
                industry: company.industry,
                current_price: stats.current_price,
                previous_close: stats.previous_close,
                market_cap: stats.market_cap,
                trailing_pe: stats.trailing_pe,
                forward_pe: stats.forward_pe,
                beta: stats.beta,
                dividend_yield: stats.dividend_yield,
                price_to_book: stats.price_to_book,
                fifty_two_week_low: stats.fifty_two_week_low,
                fifty_two_week_high: stats.fifty_two_week_high,
                roe: ratios.roe,
                roa: ratios.roa,
                debt_to_equity: ratios.debt_to_equity,
                current_ratio: ratios.current_ratio,
                gross_margin: ratios.gross_margin,
                operating_margin: ratios.operating_margin,
                net_margin: ratios.net_margin,
                revenue_growth_yoy: ratios.revenue_growth_yoy
            }}
    """
    count_aql = f"""
        FOR company IN companies
            LET stats = DOCUMENT('stock_stats', company._key)
            LET ratios = DOCUMENT('financial_ratios', company._key)
            FILTER {filter_expr}
            COLLECT WITH COUNT INTO total
            RETURN total
    """

    results = list(db.aql.execute(aql, bind_vars=bind_vars))
    total_cursor = list(db.aql.execute(count_aql, bind_vars={k: v for k, v in bind_vars.items() if k not in ("limit", "offset")}))
    total = total_cursor[0] if total_cursor else 0

    return {"results": results, "total": total, "limit": limit, "offset": offset}


def get_company_detail(ticker: str) -> dict | None:
    db = get_db()
    ticker = ticker.upper()
    if not db.collection("companies").has(ticker):
        return None

    company = db.collection("companies").get(ticker)
    stats = db.collection("stock_stats").get(ticker)
    ratios = db.collection("financial_ratios").get(ticker)

    cursor = db.aql.execute(
        """
        FOR p IN stock_prices
            FILTER p.ticker == @ticker
            SORT p.date ASC
            RETURN {date: p.date, close: p.close, percentage_change: p.percentage_change}
        """,
        bind_vars={"ticker": ticker},
    )
    history = list(cursor)

    return {
        "ticker": ticker,
        "company": {k: v for k, v in (company or {}).items() if not k.startswith("_")},
        "stats": {k: v for k, v in (stats or {}).items() if not k.startswith("_")},
        "ratios": {k: v for k, v in (ratios or {}).items() if not k.startswith("_")},
        "history": history,
    }


def list_sectors() -> list[str]:
    """Distinct sectors, from the normalized `sectors` collection (populated
    during import) rather than scanning `companies` every call."""
    db = get_db()
    cursor = db.aql.execute("FOR s IN sectors SORT s.name RETURN s.name")
    return list(cursor)


def list_industries(sector: str | None = None) -> list[str]:
    """Distinct industries, optionally scoped to one sector, from the
    normalized `industries` collection."""
    db = get_db()
    if sector:
        cursor = db.aql.execute(
            "FOR i IN industries FILTER i.sector == @sector SORT i.name RETURN i.name",
            bind_vars={"sector": sector},
        )
    else:
        cursor = db.aql.execute("FOR i IN industries SORT i.name RETURN i.name")
    return list(cursor)
