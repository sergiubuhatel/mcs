"""Search/filter/sort the company universe by valuation, profitability, and
debt indicators, and inspect one company's price history + fundamentals.
"""

from flask import Blueprint, jsonify, request

from ..services.screening import FILTERABLE_RANGES, get_company_detail, list_industries, list_sectors, search_companies

bp = Blueprint("companies", __name__, url_prefix="/api/companies")


def _float_or_none(value):
    if value in (None, ""):
        return None
    return float(value)


@bp.get("")
def list_companies():
    args = request.args

    ranges = {}
    for key in FILTERABLE_RANGES:
        lo = _float_or_none(args.get(f"{key}_min"))
        hi = _float_or_none(args.get(f"{key}_max"))
        if lo is not None or hi is not None:
            ranges[key] = (lo, hi)

    result = search_companies(
        sector=args.get("sector") or None,
        industry=args.get("industry") or None,
        query=args.get("q") or None,
        ranges=ranges,
        sort_by=args.get("sort_by", "market_cap"),
        sort_dir=args.get("sort_dir", "desc"),
        limit=min(int(args.get("limit", 50)), 500),
        offset=int(args.get("offset", 0)),
    )
    return jsonify(result)


@bp.get("/sectors")
def sectors():
    return jsonify({"sectors": list_sectors()})


@bp.get("/industries")
def industries():
    return jsonify({"industries": list_industries(sector=request.args.get("sector") or None)})


@bp.get("/<ticker>")
def company_detail(ticker: str):
    detail = get_company_detail(ticker)
    if detail is None:
        return jsonify({"error": f"Unknown ticker '{ticker}'"}), 404
    return jsonify(detail)
