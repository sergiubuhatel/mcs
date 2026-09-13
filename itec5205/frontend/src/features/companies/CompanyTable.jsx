import { Link, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { fetchRequested, setFilters, toggleSelected } from "./companiesSlice";

const COLUMNS = [
  { key: "ticker", label: "Ticker", sortable: false },
  { key: "name", label: "Company", sortable: true },
  { key: "sector", label: "Sector", sortable: false },
  { key: "current_price", label: "Price", sortable: false },
  { key: "day_change", label: "Change", sortable: false },
  { key: "market_cap", label: "Mkt Cap", sortable: true, fmt: (v) => fmtLarge(v) },
  { key: "trailing_pe", label: "P/E", sortable: true, fmt: fmtNum },
  { key: "roe", label: "ROE", sortable: true, fmt: fmtPct },
  { key: "roa", label: "ROA", sortable: true, fmt: fmtPct },
  { key: "debt_to_equity", label: "D/E", sortable: true, fmt: fmtNum },
  { key: "gross_margin", label: "Gross Margin", sortable: true, fmt: fmtPct },
  { key: "net_margin", label: "Net Margin", sortable: true, fmt: fmtPct },
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

  const onSort = (key) => {
    const sortDir = filters.sortBy === key && filters.sortDir === "desc" ? "asc" : "desc";
    dispatch(setFilters({ sortBy: key, sortDir }));
    dispatch(fetchRequested());
  };

  const selectedCount = Object.keys(selected).length;

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
              <th></th>
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
                <td>{fmtLarge(row.market_cap)}</td>
                <td>{fmtNum(row.trailing_pe)}</td>
                <td>{fmtPct(row.roe)}</td>
                <td>{fmtPct(row.roa)}</td>
                <td>{fmtNum(row.debt_to_equity)}</td>
                <td>{fmtPct(row.gross_margin)}</td>
                <td>{fmtPct(row.net_margin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
