import { useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { fetchRequested, setFilters, toggleSelectAll, toggleSelected } from "./companiesSlice";
import { ListIcon, SpinnerIcon } from "../../layout/icons";
import { sectorColor } from "../../utils/sectorColors";
import { useColumnConfig } from "../../utils/useColumnConfig";
import ColumnPicker from "../../components/ColumnPicker";

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
function fmtSignedPct(v) {
  if (v === null || v === undefined) return "-";
  const pct = Number(v) * 100;
  return `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`;
}
// dividend_yield comes back from yfinance already as a plain percent number
// (e.g. 0.44 meaning 0.44%), unlike roe/roa/margins/growth (decimal
// fractions) -- so this doesn't multiply by 100 like fmtPct does.
function fmtRawPct(v) {
  return v === null || v === undefined ? "-" : `${Number(v).toFixed(2)}%`;
}

export default function CompanyTable() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { results, total, filters, selected, loading, error } = useSelector((s) => s.companies);
  const selectAllRef = useRef(null);

  const COLUMNS = [
    { key: "ticker", label: "Ticker", sortable: true, locked: true, width: 70, render: (row) => <Link to={`/companies/${row.ticker}`} onClick={(e) => e.stopPropagation()}>{row.ticker}</Link> },
    {
      key: "name",
      label: "Company",
      sortable: true,
      left: true,
      width: undefined,
      render: (row) => (
        <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.name}>
          {row.name}
        </span>
      ),
    },
    {
      key: "sector",
      label: "Sector",
      sortable: true,
      left: true,
      width: 150,
      render: (row) =>
        row.sector ? (
          <span className="pill" style={{ background: `${sectorColor(row.sector)}26`, color: sectorColor(row.sector) }}>
            {row.sector}
          </span>
        ) : (
          "-"
        ),
    },
    {
      key: "current_price",
      label: "Price",
      sortable: true,
      width: 85,
      render: (row) => (
        <span style={{ color: changeColor(dayChangePct(row)), fontWeight: 600 }}>
          {row.current_price != null ? `$${Number(row.current_price).toFixed(2)}` : "-"}
        </span>
      ),
    },
    {
      key: "day_change",
      label: "Change (1D)",
      sortable: true,
      width: 95,
      render: (row) => {
        const chg = dayChangePct(row);
        return (
          <span style={{ color: changeColor(chg), fontWeight: 600 }}>
            {chg === null ? "-" : `${chg > 0 ? "+" : ""}${chg.toFixed(2)}%`}
          </span>
        );
      },
    },
    {
      key: "stock_growth_1y",
      label: "Change (1Y)",
      sortable: true,
      width: 95,
      render: (row) => <span style={{ color: changeColor(row.stock_growth_1y), fontWeight: 600 }}>{fmtSignedPct(row.stock_growth_1y)}</span>,
    },
    { key: "volatility", label: "Volatility (1Y)", sortable: true, width: 95, render: (row) => fmtPct(row.volatility) },
    { key: "market_cap", label: "Mkt Cap", sortable: true, width: 90, render: (row) => fmtLarge(row.market_cap != null ? row.market_cap * 1e6 : null) },
    { key: "trailing_pe", label: "P/E", sortable: true, width: 70, render: (row) => fmtNum(row.trailing_pe) },
    { key: "revenue_growth_yoy", label: "Rev Growth", sortable: true, width: 95, render: (row) => fmtPct(row.revenue_growth_yoy) },
    { key: "earnings_growth_yoy_q", label: "EPS Growth", sortable: true, width: 95, render: (row) => fmtPct(row.earnings_growth_yoy_q) },
    { key: "roe", label: "ROE", sortable: true, width: 70, render: (row) => fmtPct(row.roe) },
    { key: "roa", label: "ROA", sortable: true, width: 70, render: (row) => fmtPct(row.roa) },
    { key: "debt_to_equity", label: "D/E", sortable: true, width: 70, render: (row) => fmtNum(row.debt_to_equity) },
    // Present in the screener's filter form but not shown here by default --
    // available via the Columns picker instead of crowding the default view.
    { key: "forward_pe", label: "Forward P/E", sortable: true, width: 80, hiddenByDefault: true, render: (row) => fmtNum(row.forward_pe) },
    { key: "peg_ratio", label: "PEG Ratio", sortable: true, width: 80, hiddenByDefault: true, render: (row) => fmtNum(row.peg_ratio) },
    { key: "gross_margin", label: "Gross Margin", sortable: true, width: 95, hiddenByDefault: true, render: (row) => fmtPct(row.gross_margin) },
    { key: "operating_margin", label: "Op Margin", sortable: true, width: 90, hiddenByDefault: true, render: (row) => fmtPct(row.operating_margin) },
    { key: "net_margin", label: "Net Margin", sortable: true, width: 90, hiddenByDefault: true, render: (row) => fmtPct(row.net_margin) },
    { key: "current_ratio", label: "Current Ratio", sortable: true, width: 95, hiddenByDefault: true, render: (row) => fmtNum(row.current_ratio) },
    { key: "ev_to_ebitda", label: "EV/EBITDA", sortable: true, width: 90, hiddenByDefault: true, render: (row) => fmtNum(row.ev_to_ebitda) },
    { key: "dividend_yield", label: "Dividend Yield", sortable: true, width: 100, hiddenByDefault: true, render: (row) => fmtRawPct(row.dividend_yield) },
    { key: "free_cash_flow", label: "Free Cash Flow", sortable: true, width: 100, render: (row) => fmtLarge(row.free_cash_flow) },
  ];

  const { columns, visibleColumns, hidden, toggleVisible, moveColumn, reset } = useColumnConfig("companyTable", COLUMNS);

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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="icon-badge" style={{ background: "rgba(59,130,246,0.15)", color: "#3b82f6" }}>
            <ListIcon />
          </div>
          <h3 style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
            Results {loading ? <SpinnerIcon className="spin" style={{ color: "var(--color-text-accent)" }} /> : `(${total})`}
          </h3>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className="muted">{selectedCount} selected for pool</span>
          <ColumnPicker columns={columns} hidden={hidden} onToggle={toggleVisible} onMove={moveColumn} onReset={reset} />
        </div>
      </div>
      {error && <p className="error-text">{error}</p>}
      <div style={{ overflowX: "auto" }}>
        <table style={{ tableLayout: "fixed", width: "100%" }}>
          <colgroup>
            <col style={{ width: 34 }} />
            {visibleColumns.map((c) => (
              <col key={c.key} style={c.width ? { width: c.width } : undefined} />
            ))}
          </colgroup>
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
              {visibleColumns.map((c) => (
                <th
                  key={c.key}
                  className={filters.sortBy === c.key ? "sorted" : ""}
                  onClick={() => c.sortable && onSort(c.key)}
                  style={c.left ? { textAlign: "left" } : undefined}
                >
                  {c.label}
                  {c.sortable && (
                    <span style={{ visibility: filters.sortBy === c.key ? "visible" : "hidden" }}>
                      {" "}{filters.sortDir === "desc" ? "↓" : "↑"}
                    </span>
                  )}
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
                {visibleColumns.map((c) => (
                  <td
                    key={c.key}
                    style={c.left ? { textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } : undefined}
                  >
                    {c.render(row)}
                  </td>
                ))}
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
