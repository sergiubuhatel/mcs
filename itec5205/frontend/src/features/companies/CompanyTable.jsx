import { useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { fetchRequested, setFilters, toggleSelectAll, toggleSelected } from "./companiesSlice";

const COLUMNS = [
  { key: "ticker", label: "Ticker", sortable: true },
  { key: "name", label: "Company", sortable: true },
  { key: "sector", label: "Sector", sortable: true },
  { key: "current_price", label: "Price", sortable: true },
  { key: "day_change", label: "Change", sortable: true },
  { key: "market_cap", label: "Mkt Cap", sortable: true, fmt: (v) => fmtLarge(v) },
  { key: "trailing_pe", label: "P/E", sortable: true, fmt: fmtNum },
  { key: "revenue_growth_yoy", label: "Qtr Revenue Growth", sortable: true, fmt: fmtPct },
  { key: "earnings_growth_yoy_q", label: "Qtr Earnings Growth", sortable: true, fmt: fmtPct },
  { key: "roe", label: "ROE", sortable: true, fmt: fmtPct },
  { key: "roa", label: "ROA", sortable: true, fmt: fmtPct },
  { key: "debt_to_equity", label: "D/E", sortable: true, fmt: fmtNum },
];

function fmtNum(v) {
  return v === null || v === undefined ? "-" : Number(v).toFixed(2);
}
function fmtPct(v) {
  return v === null || v === undefined ? "-" : `${(Number(v) * 100).toFixed(1)}%`;
}
function fmtLarge(v) {
  if (v === null || v === undefined) return "-";
  const n = Number(v);
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n.toFixed(0)}`;
}
function dayChangePct(row) {
  if (row.current_price == null || !row.previous_close) return null;
  return ((row.current_price - row.previous_close) / row.previous_close) * 100;
}
function changeColor(value) {
  if (value === null || value === undefined || value === 0) return "var(--color-text-primary)";
  return value > 0 ? "#16a34a" : "#dc2626";
}

export default function CompanyTable() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { results, total, filters, selected, loading, error } = useSelector((s) => s.companies);
  const selectAllRef = useRef(null);

  const onSort = (key) => {
    const sortDir = filters.sortBy === key && filters.sortDir === "desc" ? "asc" : "desc";
    dispatch(setFilters({ sortBy: key, sortDir }));
    dispatch(fetchRequested());
  };

  const goToOffset = (offset) => {
    dispatch(setFilters({ offset }));
    dispatch(fetchRequested());
  };

  const onLimitChange = (e) => {
    dispatch(setFilters({ limit: Number(e.target.value), offset: 0 }));
    dispatch(fetchRequested());
  };

  const selectedCount = Object.keys(selected).length;
  const pageTickers = results.map((r) => r.ticker);
  const pageSelectedCount = pageTickers.filter((t) => selected[t]).length;
  const allPageSelected = pageTickers.length > 0 && pageSelectedCount === pageTickers.length;

  if (selectAllRef.current) {
    selectAllRef.current.indeterminate = pageSelectedCount > 0 && !allPageSelected;
  }

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3>Results {loading ? "(loading...)" : `(${total})`}</h3>
        <span className="muted">{selectedCount} selected for pool</span>
      </div>
      {error && <p className="error-text">{error}</p>}
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allPageSelected}
                  disabled={pageTickers.length === 0}
                  onChange={() => dispatch(toggleSelectAll(pageTickers))}
                  title="Select all on this page"
                />
              </th>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  className={filters.sortBy === c.key ? "sorted" : ""}
                  onClick={() => c.sortable && onSort(c.key)}
                >
                  {c.label}{filters.sortBy === c.key ? (filters.sortDir === "desc" ? " ↓" : " ↑") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {results.map((row) => (
              <tr
                key={row.ticker}
                onClick={() => navigate(`/companies/${row.ticker}`)}
                style={{ cursor: "pointer" }}
              >
                <td onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={!!selected[row.ticker]} onChange={() => dispatch(toggleSelected(row.ticker))} />
                </td>
                <td><Link to={`/companies/${row.ticker}`} onClick={(e) => e.stopPropagation()}>{row.ticker}</Link></td>
                <td>{row.name}</td>
                <td><span className="pill">{row.sector || "-"}</span></td>
                <td style={{ color: changeColor(dayChangePct(row)), fontWeight: 600 }}>
                  {row.current_price != null ? `$${Number(row.current_price).toFixed(2)}` : "-"}
                </td>
                <td style={{ color: changeColor(dayChangePct(row)), fontWeight: 600 }}>
                  {(() => {
                    const chg = dayChangePct(row);
                    if (chg === null) return "-";
                    return `${chg > 0 ? "+" : ""}${chg.toFixed(2)}%`;
                  })()}
                </td>
                <td>{fmtLarge(row.market_cap != null ? row.market_cap * 1e6 : null)}</td>
                <td>{fmtNum(row.trailing_pe)}</td>
                <td>{fmtPct(row.revenue_growth_yoy)}</td>
                <td>{fmtPct(row.earnings_growth_yoy_q)}</td>
                <td>{fmtPct(row.roe)}</td>
                <td>{fmtPct(row.roa)}</td>
                <td>{fmtNum(row.debt_to_equity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, flexWrap: "wrap", gap: 8 }}>
        <span className="muted">
          {total === 0
            ? "No results"
            : `Showing ${filters.offset + 1}–${Math.min(filters.offset + filters.limit, total)} of ${total}`}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label className="muted" style={{ fontSize: "0.85rem" }}>
            Rows per page{" "}
            <select value={filters.limit} onChange={onLimitChange}>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={250}>250</option>
              <option value={600}>600 (all)</option>
            </select>
          </label>
          <button
            className="btn secondary"
            disabled={filters.offset === 0}
            onClick={() => goToOffset(Math.max(0, filters.offset - filters.limit))}
          >
            &larr; Prev
          </button>
          <button
            className="btn secondary"
            disabled={filters.offset + filters.limit >= total}
            onClick={() => goToOffset(filters.offset + filters.limit)}
          >
            Next &rarr;
          </button>
        </div>
      </div>
    </div>
  );
}
