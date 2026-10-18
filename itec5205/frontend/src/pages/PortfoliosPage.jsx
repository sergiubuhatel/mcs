import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { createRequested, deleteRequested, fetchRequested, updateRequested } from "../features/portfolios/portfoliosSlice";
import ManualPortfolioForm from "../features/portfolios/ManualPortfolioForm";
import ActionMenu from "../components/ActionMenu";
import ConfirmDeleteModal from "../components/ConfirmDeleteModal";
import Modal from "../components/Modal";
import LoadingSpinner from "../components/LoadingSpinner";
import ColumnPicker from "../components/ColumnPicker";
import { InfoPanels, PageHeader, Pager, SearchBox, SortTh, StatTiles, useSort, usePager } from "../components/PageParts";
import { useColumnConfig } from "../utils/useColumnConfig";
import {
  BarChartIcon,
  BookmarkPlusIcon,
  ClockIcon,
  LayersIcon,
  PieChartIcon,
  PlusIcon,
  SaveIcon,
  TrendChartIcon,
  WorkflowIcon,
} from "../layout/icons";
import { getSettings } from "../features/settings/settings";

const PREVIEW_TICKERS = 5;
const ellipsis = { display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const fmtPct = (v, sign = false) => (v == null ? "–" : `${sign && v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`);

// Risk band from the portfolio's annualized volatility over the past year.
export function riskBand(vol) {
  if (vol == null) return null;
  if (vol < 0.2) return { label: "Low", tone: "good" };
  if (vol < 0.35) return { label: "Medium", tone: "warn" };
  return { label: "High", tone: "bad" };
}

const METHOD = { rl: { label: "RL optimized", icon: WorkflowIcon }, manual: { label: "Manual", icon: BookmarkPlusIcon } };

const PORTFOLIO_COLUMNS = [
  {
    key: "name",
    label: "Name",
    locked: true,
    width: 300,
    sortable: true,
    render: (p, ctx) =>
      ctx.isEditing ? (
        <input value={ctx.editName} onChange={(e) => ctx.setEditName(e.target.value)} style={{ width: "100%" }} />
      ) : (
        <Link to={`/portfolios/${p._key}`} title={p.name} style={ellipsis}>{p.name}</Link>
      ),
  },
  {
    key: "tickers",
    label: "Holdings",
    render: (p) => {
      const byWeight = [...p.holdings].sort((a, b) => b.weight - a.weight);
      return (
        <span
          title={byWeight.map((h) => `${h.ticker} ${(h.weight * 100).toFixed(1)}%`).join(", ")}
          style={{ display: "flex", gap: 4, overflow: "hidden", whiteSpace: "nowrap" }}
        >
          {byWeight.slice(0, PREVIEW_TICKERS).map((h) => <span key={h.ticker} className="ticker-chip">{h.ticker}</span>)}
          {byWeight.length > PREVIEW_TICKERS && <span className="ticker-chip">+{byWeight.length - PREVIEW_TICKERS}</span>}
        </span>
      );
    },
  },
  {
    key: "method",
    label: "Built with",
    width: 140,
    sortable: true,
    render: (p) => {
      const m = METHOD[p.method] || { label: p.method || "–", icon: LayersIcon };
      const Icon = m.icon;
      return <span className="method-chip"><Icon width={12} height={12} /> {m.label}</span>;
    },
  },
  {
    key: "risk",
    label: "Risk",
    width: 100,
    sortable: true,
    render: (p) => {
      const band = riskBand(p.expected_volatility);
      return band ? (
        <span className={`status-pill ${band.tone}`} title={`Volatility ${fmtPct(p.expected_volatility)} a year (low < 20%, high ≥ 35%)`}>{band.label}</span>
      ) : "–";
    },
  },
  {
    key: "annual_return",
    label: "Return (1Y)",
    width: 120,
    sortable: true,
    render: (p) => (
      <strong title="Past-year return of these weights" style={{ color: p.annual_return == null ? undefined : p.annual_return >= 0 ? "#16a34a" : "#dc2626" }}>
        {fmtPct(p.annual_return, true)}
      </strong>
    ),
  },
  { key: "sharpe_ratio", label: "Sharpe", width: 90, sortable: true, hiddenByDefault: true, render: (p) => (p.sharpe_ratio == null ? "–" : p.sharpe_ratio.toFixed(2)) },
  { key: "created_at", label: "Created", width: 120, sortable: true, render: (p) => fmtDate(p.created_at) },
];

const ABOUT = {
  icon: PieChartIcon,
  color: "#8b5cf6",
  title: "About my portfolios",
  text: "A portfolio is a set of holdings with weights. Most come from the RL builder on a stock pool or from a workflow run; you can also build one by hand.",
  features: [
    { icon: BookmarkPlusIcon, color: "#3b82f6", title: "From a pool or workflow", text: "RL portfolios keep a link to the pool they were trained on." },
    { icon: WorkflowIcon, color: "#10b981", title: "Optimized with RL", text: "PPO weights, blended toward the optimizer when a limit would be missed." },
    { icon: BarChartIcon, color: "#f59e0b", title: "Risk at a glance", text: "Risk is the past year's annualized volatility: low < 20%, high ≥ 35%." },
    { icon: TrendChartIcon, color: "#06b6d4", title: "Track performance", text: "Open a portfolio for its value chart, allocation and signal board." },
  ],
};

const TIPS = [
  { title: "Build from a pool", text: "Stock Pools → pick a pool → train the RL portfolio, or run a workflow." },
  { title: "Compare portfolios", text: "Sort by Return (1Y) or Risk; open one to see its chart over 1M–ALL." },
  { title: "Refine and iterate", text: "Refine the pool on its signal board and retrain to compare iterations." },
];

export default function PortfoliosPage() {
  const dispatch = useDispatch();
  const { items, loading, creating } = useSelector((s) => s.portfolios);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [buildOpen, setBuildOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    dispatch(fetchRequested());
  }, [dispatch]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((p) => p.name.toLowerCase().includes(q) || p.holdings.some((h) => h.ticker.toLowerCase().includes(q)));
  }, [items, query]);
  const { sorted, sort, toggle } = useSort(
    filtered,
    {
      name: (p) => p.name,
      method: (p) => p.method || "",
      risk: (p) => p.expected_volatility,
      annual_return: (p) => p.annual_return,
      sharpe_ratio: (p) => p.sharpe_ratio,
      created_at: (p) => p.created_at,
    },
    { key: "created_at", dir: "desc" }
  );
  const pager = usePager(sorted, Number(getSettings().general.list_page_size));

  const startRename = (p) => {
    setEditingId(p._key);
    setEditName(p.name);
  };
  const saveEdit = (id) => {
    dispatch(updateRequested({ id, name: editName.trim() }));
    setEditingId(null);
  };
  const confirmDelete = () => {
    dispatch(deleteRequested(deleteTarget._key));
    setDeleteTarget(null);
  };
  const duplicatePortfolio = (p) => {
    dispatch(
      createRequested({
        name: `${p.name} (copy)`,
        holdings: p.holdings.map((h) => ({ ticker: h.ticker, weight: h.weight })),
        method: p.method,
      })
    );
  };

  const { columns, visibleColumns, hidden, toggleVisible, moveColumn, reset } = useColumnConfig("portfoliosGrid", PORTFOLIO_COLUMNS);

  const latest = items.reduce((a, p) => (!a || p.created_at > a.created_at ? p : a), null);
  const best = items.reduce((a, p) => (p.annual_return != null && (!a || p.annual_return > a.annual_return) ? p : a), null);
  const rlCount = items.filter((p) => p.method === "rl").length;
  const avgHoldings = items.length ? items.reduce((n, p) => n + p.holdings.length, 0) / items.length : 0;
  const tiles = [
    { icon: LayersIcon, color: "#8b5cf6", label: "Total portfolios", value: items.length, sub: `${rlCount} RL optimized · ${items.length - rlCount} manual` },
    { icon: ClockIcon, color: "#10b981", label: "Last created", value: latest ? fmtDate(latest.created_at) : "–", sub: latest?.name || "none yet", title: latest?.name },
    { icon: TrendChartIcon, color: "#16a34a", label: "Best return (1Y)", value: best ? fmtPct(best.annual_return, true) : "–", sub: best?.name || "–", title: best?.name },
    { icon: BarChartIcon, color: "#3b82f6", label: "Average holdings", value: avgHoldings ? avgHoldings.toFixed(1) : "–", sub: "companies per portfolio" },
  ];
  const leftAligned = (key) => ["name", "tickers", "method", "risk"].includes(key);

  return (
    <div>
      <PageHeader
        icon={PieChartIcon}
        color="#3b82f6"
        title="My portfolios"
        description="Saved portfolio allocations: RL-optimized ones from stock pools and workflow runs, and portfolios you built by hand."
      />
      <StatTiles tiles={tiles} />

      <div className="card">
        <div className="card-header" style={{ flexWrap: "wrap" }}>
          <div className="icon-badge" style={{ background: "#3b82f622", color: "#3b82f6" }}>
            <PieChartIcon width={18} height={18} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3 style={{ margin: 0 }}>Portfolio library</h3>
            <p className="muted" style={{ margin: 0 }}>Holdings, how each was built, risk and the past year's return.</p>
          </div>
          <div className="toolbar">
            <SearchBox id="search-portfolios" value={query} onChange={setQuery} placeholder="Search by name or ticker…" />
            <ColumnPicker columns={columns} hidden={hidden} onToggle={toggleVisible} onMove={moveColumn} onReset={reset} />
            <button className="btn" onClick={() => setBuildOpen(true)}>
              <PlusIcon width={15} height={15} /> New portfolio
            </button>
          </div>
        </div>
        {loading && <LoadingSpinner />}
        {items.length === 0 && !loading && <p className="muted">No portfolios yet.</p>}
        {items.length > 0 && filtered.length === 0 && <p className="muted">No portfolio matches "{query}".</p>}
        <table style={{ tableLayout: "fixed", width: "100%" }}>
          <colgroup>
            {visibleColumns.map((c) => (
              <col key={c.key} style={c.width ? { width: c.width } : undefined} />
            ))}
            <col style={{ width: 70 }} />
          </colgroup>
          <thead>
            <tr>
              {visibleColumns.map((c) => (
                <SortTh
                  key={c.key}
                  label={c.label}
                  colKey={c.key}
                  sortable={c.sortable}
                  sort={sort}
                  onSort={toggle}
                  style={leftAligned(c.key) ? { textAlign: "left" } : undefined}
                />
              ))}
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {pager.rows.map((p) => {
              const isEditing = editingId === p._key;
              const ctx = { isEditing, editName, setEditName };
              return (
                <tr key={p._key}>
                  {visibleColumns.map((c) => (
                    <td key={c.key} style={leftAligned(c.key) ? { textAlign: "left", maxWidth: 0 } : undefined}>
                      {c.render(p, ctx)}
                    </td>
                  ))}
                  <td>
                    {isEditing ? (
                      <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                        <button className="btn" onClick={() => saveEdit(p._key)}>Save</button>
                        <button className="btn secondary" onClick={() => setEditingId(null)}>Cancel</button>
                      </div>
                    ) : (
                      <ActionMenu onRename={() => startRename(p)} onDuplicate={() => duplicatePortfolio(p)} onDelete={() => setDeleteTarget(p)} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length > 0 && <Pager pager={pager} total={filtered.length} noun="portfolios" />}
      </div>

      <InfoPanels about={ABOUT} tips={TIPS} />

      <ConfirmDeleteModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        itemName={deleteTarget?.name}
        title="Delete portfolio"
      />

      <Modal
        isOpen={buildOpen}
        onClose={() => setBuildOpen(false)}
        title="Build a manual portfolio"
        headerActions={
          <button
            className="close-btn"
            style={{ position: "static", opacity: creating ? 0.5 : 1, cursor: creating ? "not-allowed" : "pointer" }}
            type="submit"
            form="manual-portfolio-form"
            disabled={creating}
            title="Save"
            aria-label="Save"
          >
            <SaveIcon width={18} height={18} />
          </button>
        }
      >
        <ManualPortfolioForm onDone={() => setBuildOpen(false)} />
      </Modal>
    </div>
  );
}
