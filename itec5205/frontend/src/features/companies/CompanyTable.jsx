import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { fetchRequested, setFilters, toggleSelectAll, toggleSelected } from "./companiesSlice";
import { BookmarkPlusIcon, DownloadIcon, FilterIcon, ListIcon, SpinnerIcon } from "../../layout/icons";
import { apiClient } from "../../api/client";
import { SearchBox } from "../../components/PageParts";
import { buildParams } from "./companiesSaga";
import SavePoolForm from "../pools/SavePoolForm";
import { sectorColor } from "../../utils/sectorColors";
import { useColumnConfig } from "../../utils/useColumnConfig";
import ColumnPicker from "../../components/ColumnPicker";
import { SignalBadge } from "../signals/SignalBoard";

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

const SIGNALS = ["Strong", "Mixed", "Weak", "Avoid"];

// CSV cell: quote when it holds a comma, quote or newline.
const csvCell = (v) => {
  const text = v == null ? "" : String(v);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** Funnel on the Signal header: show only one signal (client-side filter). */
function SignalFilter({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <span ref={ref} className="th-filter" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className={`th-filter-btn ${value ? "on" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title={value ? `Showing only ${value}` : "Filter by signal"}
        aria-label="Filter by signal"
      >
        <FilterIcon width={13} height={13} />
      </button>
      {open && (
        <div className="th-filter-menu" role="menu">
          {["", ...SIGNALS].map((k) => (
            <button
              key={k || "all"}
              type="button"
              role="menuitemradio"
              aria-checked={value === k}
              className={value === k ? "on" : ""}
              onClick={() => {
                onChange(k);
                setOpen(false);
              }}
            >
              {k || "All signals"}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

export default function CompanyTable() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { results, total, filters, selected, signals, loading, error } = useSelector((s) => s.companies);
  const selectAllRef = useRef(null);
  const [rowQuery, setRowQuery] = useState("");
  const [poolOpen, setPoolOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const COLUMNS = [
    { key: "ticker", csv: (row) => row.ticker, label: "Ticker", sortable: true, locked: true, width: 70, render: (row) => <Link to={`/companies/${row.ticker}`} onClick={(e) => e.stopPropagation()}>{row.ticker}</Link> },
    {
      key: "name",
      label: "Company",
      csv: (row) => row.name,
      sortable: true,
      left: true,
      width: 190,
      render: (row) => (
        <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.name}>
          {row.name}
        </span>
      ),
    },
    {
      key: "signal",
      label: "Signal",
      csv: (row) => signals[row.ticker] || "",
      sortable: true,
      left: true,
      width: 80,
      render: (row) => (signals[row.ticker] ? <SignalBadge signal={signals[row.ticker]} /> : <span className="muted">-</span>),
    },
    {
      key: "sector",
      label: "Sector",
      csv: (row) => row.sector,
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
      csv: (row) => row.current_price,
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
      csv: (row) => dayChangePct(row)?.toFixed(4),
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
      csv: (row) => row.stock_growth_1y,
      sortable: true,
      width: 95,
      render: (row) => <span style={{ color: changeColor(row.stock_growth_1y), fontWeight: 600 }}>{fmtSignedPct(row.stock_growth_1y)}</span>,
    },
    { key: "volatility", csv: (row) => row.volatility, label: "Volatility (1Y)", sortable: true, width: 95, render: (row) => fmtPct(row.volatility) },
    { key: "market_cap", csv: (row) => (row.market_cap != null ? row.market_cap * 1e6 : null), label: "Mkt Cap", sortable: true, width: 90, render: (row) => fmtLarge(row.market_cap != null ? row.market_cap * 1e6 : null) },
    { key: "trailing_pe", csv: (row) => row.trailing_pe, label: "P/E", sortable: true, width: 70, render: (row) => fmtNum(row.trailing_pe) },
    { key: "revenue_growth_yoy", csv: (row) => row.revenue_growth_yoy, label: "Rev Growth", sortable: true, width: 95, render: (row) => fmtPct(row.revenue_growth_yoy) },
    { key: "earnings_growth_yoy_q", csv: (row) => row.earnings_growth_yoy_q, label: "EPS Growth", sortable: true, width: 95, render: (row) => fmtPct(row.earnings_growth_yoy_q) },
    { key: "roe", csv: (row) => row.roe, label: "ROE", sortable: true, width: 70, render: (row) => fmtPct(row.roe) },
    { key: "roa", csv: (row) => row.roa, label: "ROA", sortable: true, width: 70, render: (row) => fmtPct(row.roa) },
    { key: "debt_to_equity", csv: (row) => row.debt_to_equity, label: "D/E", sortable: true, width: 70, render: (row) => fmtNum(row.debt_to_equity) },
    // Present in the screener's filter form but not shown here by default --
    // available via the Columns picker instead of crowding the default view.
    { key: "forward_pe", csv: (row) => row.forward_pe, label: "Forward P/E", sortable: true, width: 80, hiddenByDefault: true, render: (row) => fmtNum(row.forward_pe) },
    { key: "peg_ratio", csv: (row) => row.peg_ratio, label: "PEG Ratio", sortable: true, width: 80, hiddenByDefault: true, render: (row) => fmtNum(row.peg_ratio) },
    { key: "gross_margin", csv: (row) => row.gross_margin, label: "Gross Margin", sortable: true, width: 95, hiddenByDefault: true, render: (row) => fmtPct(row.gross_margin) },
    { key: "operating_margin", csv: (row) => row.operating_margin, label: "Op Margin", sortable: true, width: 90, hiddenByDefault: true, render: (row) => fmtPct(row.operating_margin) },
    { key: "net_margin", csv: (row) => row.net_margin, label: "Net Margin", sortable: true, width: 90, hiddenByDefault: true, render: (row) => fmtPct(row.net_margin) },
    { key: "current_ratio", csv: (row) => row.current_ratio, label: "Current Ratio", sortable: true, width: 95, hiddenByDefault: true, render: (row) => fmtNum(row.current_ratio) },
    { key: "ev_to_ebitda", csv: (row) => row.ev_to_ebitda, label: "EV/EBITDA", sortable: true, width: 90, hiddenByDefault: true, render: (row) => fmtNum(row.ev_to_ebitda) },
    { key: "dividend_yield", csv: (row) => row.dividend_yield, label: "Dividend Yield", sortable: true, width: 100, hiddenByDefault: true, render: (row) => fmtRawPct(row.dividend_yield) },
    { key: "free_cash_flow", csv: (row) => row.free_cash_flow, label: "Free Cash Flow", sortable: true, width: 100, render: (row) => fmtLarge(row.free_cash_flow) },
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

  const setSignalFilter = (signal) => {
    dispatch(setFilters({ signal, offset: 0 }));
    dispatch(fetchRequested());
  };

  // Every result (all pages, current filters + sort), visible columns only.
  const exportCsv = async () => {
    setExporting(true);
    try {
      const { data } = await apiClient.get("/api/companies", { params: { ...buildParams(filters), limit: 600, offset: 0 } });
      let rows = data.results;
      if (filters.signal) rows = rows.filter((r) => signals[r.ticker] === filters.signal);
      const cols = visibleColumns.filter((c) => c.csv);
      const lines = [cols.map((c) => csvCell(c.label)).join(",")];
      for (const r of rows) lines.push(cols.map((c) => csvCell(c.csv(r))).join(","));
      const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: `screener-results-${new Date().toISOString().slice(0, 10)}.csv` });
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const q = rowQuery.trim().toLowerCase();
  const shownRows = q
    ? results.filter((r) => `${r.ticker} ${r.name || ""} ${r.sector || ""} ${r.industry || ""}`.toLowerCase().includes(q))
    : results;

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
          {filters.signal && (
            <span className="filter-chip">
              Signal: {filters.signal}
              <button type="button" onClick={() => setSignalFilter("")} title="Show all signals" aria-label="Clear signal filter">×</button>
            </span>
          )}
        </div>
        <div className="toolbar">
          <SearchBox id="search-results" value={rowQuery} onChange={setRowQuery} placeholder="Search results…" />
          <ColumnPicker columns={columns} hidden={hidden} onToggle={toggleVisible} onMove={moveColumn} onReset={reset} />
          <button className="btn secondary" onClick={exportCsv} disabled={exporting || total === 0} title="Download every result (all pages) as CSV, with the visible columns">
            {exporting ? <SpinnerIcon className="spin" /> : <DownloadIcon />} Export
          </button>
          <button className="btn" onClick={() => setPoolOpen(true)} disabled={selectedCount === 0} title={selectedCount ? "Save the selected companies as a stock pool" : "Select companies with the checkboxes first"}>
            <BookmarkPlusIcon /> Create Stock Pool ({selectedCount})
          </button>
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
                  {c.key === "signal" && <SignalFilter value={filters.signal} onChange={setSignalFilter} />}
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
            {shownRows.map((row) => (
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
          {q && ` · ${shownRows.length} on this page match "${rowQuery.trim()}"`}
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
      <SavePoolForm isOpen={poolOpen} onClose={() => setPoolOpen(false)} />
    </div>
  );
}
