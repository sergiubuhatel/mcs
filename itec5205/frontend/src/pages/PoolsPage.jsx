import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { createRequested, deleteRequested, fetchRequested, updateRequested } from "../features/pools/poolsSlice";
import { reset as resetRl } from "../features/rl/rlSlice";
import RLTrainingPanel from "../features/rl/RLTrainingPanel";
import SignalBoard from "../features/signals/SignalBoard";
import RefinementHistory from "../features/signals/RefinementHistory";
import EditPoolModal from "../features/pools/EditPoolModal";
import ActionMenu from "../components/ActionMenu";
import ConfirmDeleteModal from "../components/ConfirmDeleteModal";
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
  SearchIcon,
  TrendChartIcon,
  WorkflowIcon,
} from "../layout/icons";
import { getSettings } from "../features/settings/settings";

const PREVIEW_TICKERS = 5;
const ellipsis = { display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

// " mandatory" / " excluded" / "" -- the chip style of a pool company.
const chipState = (p, t) =>
  (p.required_tickers || []).includes(t) ? " mandatory" : (p.excluded_tickers || []).includes(t) ? " excluded" : "";

const POOL_COLUMNS = [
  {
    key: "name",
    label: "Name",
    locked: true,
    width: 340,
    sortable: true,
    render: (p, ctx) => (
      <a onClick={() => ctx.selectPool(p._key)} title={p.name} style={{ ...ellipsis, cursor: "pointer" }}>
        {p.name}
      </a>
    ),
  },
  {
    key: "tickers",
    label: "Tickers",
    render: (p) => (
      <span title={p.tickers.join(", ")} style={{ display: "flex", gap: 4, overflow: "hidden", whiteSpace: "nowrap" }}>
        {p.tickers.slice(0, PREVIEW_TICKERS).map((t) => (
          <span key={t} className={`ticker-chip${chipState(p, t)}`}>{t}</span>
        ))}
        {p.tickers.length > PREVIEW_TICKERS && <span className="ticker-chip">+{p.tickers.length - PREVIEW_TICKERS}</span>}
      </span>
    ),
  },
  {
    key: "mandatory",
    label: "Mandatory",
    width: 110,
    sortable: true,
    render: (p) => {
      const req = p.required_tickers || [];
      return req.length ? (
        <span className="count-badge" title={`Always in the generated portfolio: ${req.join(", ")}`}>{req.length}</span>
      ) : (
        <span className="muted">–</span>
      );
    },
  },
  {
    key: "excluded",
    label: "Excluded",
    width: 100,
    sortable: true,
    render: (p) => {
      const out = p.excluded_tickers || [];
      return out.length ? (
        <span className="count-badge red" title={`Never in the generated portfolio: ${out.join(", ")}`}>{out.length}</span>
      ) : (
        <span className="muted">–</span>
      );
    },
  },
  { key: "size", label: "Pool size", width: 100, sortable: true, render: (p) => <span className="count-badge">{p.tickers.length}</span> },
  { key: "created_at", label: "Created", width: 120, sortable: true, render: (p) => fmtDate(p.created_at) },
  {
    key: "iteration",
    label: "Iteration",
    width: 100,
    sortable: true,
    render: (p) => (
      <span
        className={`count-badge ${p.iteration ? "green" : "grey"}`}
        title={p.iteration ? `Refined from an earlier pool (dropped ${(p.dropped || []).join(", ")})` : "Saved from the screener"}
      >
        {p.iteration || 0}
      </span>
    ),
  },
];

const ABOUT = {
  icon: BookmarkPlusIcon,
  color: "#8b5cf6",
  title: "About stock pools",
  text: "A pool is a set of companies saved from the Stock Screener, with the search that produced it. Pick one to forecast its companies, train RL on it, and refine it.",
  features: [
    { icon: SearchIcon, color: "#3b82f6", title: "From screening", text: "Select rows on the Stock Screener and save them as a pool." },
    { icon: TrendChartIcon, color: "#06b6d4", title: "Signal board", text: "LSTM, ARIMA, RL weight and fundamentals per company, as one signal." },
    { icon: PieChartIcon, color: "#22c55e", title: "RL builder", text: "Train a low-risk / high-return allocation over the pool's companies." },
    { icon: LayersIcon, color: "#f59e0b", title: "Iterations", text: "Refining drops weak signals into a new pool; compare portfolios across iterations." },
  ],
};

const TIPS = [
  { title: "Create focused pools", text: "Screen first (e.g. growth, low P/E); RL and forecasts run on every company in the pool." },
  { title: "Forecast, then train RL", text: "Run Forecast all on the signal board so the RL builder can use only Strong signals." },
  { title: "Mandatory / excluded", text: "Mark companies that must, or must never, be in the portfolio (Edit pool or the RL builder)." },
  { title: "Compare iterations", text: "Refine, retrain, and check the refinement history for the best portfolio." },
];

export default function PoolsPage() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { items, loading } = useSelector((s) => s.pools);
  // Changes when an RL run finishes, so the signal board / history pick up the new portfolio.
  const rlResultId = useSelector((s) => s.rl.result?.portfolio_id);
  const [activePoolId, setActivePoolId] = useState(null);
  const [editTarget, setEditTarget] = useState(null); // pool open in the Edit dialog
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    dispatch(fetchRequested());
  }, [dispatch]);

  const activePool = items.find((p) => p._key === activePoolId);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((p) => p.name.toLowerCase().includes(q) || p.tickers.some((t) => t.toLowerCase().includes(q)));
  }, [items, query]);
  const { sorted, sort, toggle } = useSort(
    filtered,
    { name: (p) => p.name, size: (p) => p.tickers.length, mandatory: (p) => (p.required_tickers || []).length,
      excluded: (p) => (p.excluded_tickers || []).length, created_at: (p) => p.created_at, iteration: (p) => p.iteration || 0 },
    { key: "created_at", dir: "desc" }
  );
  const pager = usePager(sorted, Number(getSettings().general.list_page_size));

  const selectPool = (id) => {
    dispatch(resetRl());
    setActivePoolId(id);
  };

  const saveEdit = (changes) => {
    dispatch(updateRequested(changes));
    setEditTarget(null);
  };

  const confirmDelete = () => {
    dispatch(deleteRequested(deleteTarget._key));
    setDeleteTarget(null);
  };

  const duplicatePool = (p) => {
    dispatch(createRequested({ name: `${p.name} (copy)`, tickers: p.tickers, filters: p.filters, required_tickers: p.required_tickers, excluded_tickers: p.excluded_tickers }));
  };

  const { columns, visibleColumns, hidden, toggleVisible, moveColumn, reset } = useColumnConfig("poolsGrid", POOL_COLUMNS);

  const latest = items.reduce((a, p) => (!a || p.created_at > a.created_at ? p : a), null);
  const largest = items.reduce((a, p) => (!a || p.tickers.length > a.tickers.length ? p : a), null);
  const refined = items.filter((p) => p.iteration > 0).length;
  const tiles = [
    { icon: LayersIcon, color: "#8b5cf6", label: "Total pools", value: items.length, sub: "saved from screening or refined" },
    { icon: ClockIcon, color: "#10b981", label: "Last created", value: latest ? fmtDate(latest.created_at) : "–", sub: latest?.name || "no pools yet", title: latest?.name },
    { icon: WorkflowIcon, color: "#f59e0b", label: "Refined pools", value: refined, sub: "iteration 1 or later" },
    { icon: BarChartIcon, color: "#3b82f6", label: "Largest pool", value: largest ? largest.tickers.length : "–", sub: largest ? `tickers · ${largest.name}` : "–", title: largest?.name },
  ];
  const leftAligned = (key) => !["created_at", "iteration", "size", "mandatory", "excluded"].includes(key);

  return (
    <div>
      <PageHeader
        icon={BookmarkPlusIcon}
        color="#3b82f6"
        title="Stock pools"
        description="Candidate pools saved from the Stock Screener. Pick a pool to forecast its companies and run reinforcement learning for a low-risk / high-return allocation."
      />
      <StatTiles tiles={tiles} />

      <div className="card">
        <div className="card-header" style={{ flexWrap: "wrap" }}>
          <div className="icon-badge" style={{ background: "#3b82f622", color: "#3b82f6" }}>
            <BookmarkPlusIcon width={18} height={18} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3 style={{ margin: 0 }}>Candidate pools</h3>
            <p className="muted" style={{ margin: 0 }}>Click a pool's name to open its signal board and RL builder.</p>
          </div>
          <div className="toolbar">
            <SearchBox id="search-pools" value={query} onChange={setQuery} placeholder="Search by name or ticker…" />
            <ColumnPicker columns={columns} hidden={hidden} onToggle={toggleVisible} onMove={moveColumn} onReset={reset} />
            <button className="btn" onClick={() => navigate("/screener")} title="Pools are saved from the Stock Screener: select rows there and save them">
              <PlusIcon width={15} height={15} /> New pool
            </button>
          </div>
        </div>
        {loading && <LoadingSpinner />}
        {items.length === 0 && !loading && <p className="muted">No pools yet — go to the Stock Screener, select some tickers, and save a pool.</p>}
        {items.length > 0 && filtered.length === 0 && <p className="muted">No pool matches "{query}".</p>}
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
                  style={leftAligned(c.key) ? { textAlign: "left" } : { textAlign: "center" }}
                />
              ))}
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {pager.rows.map((p) => {
              const ctx = { selectPool };
              return (
                <tr key={p._key} className={p._key === activePoolId ? "selected" : ""}>
                  {visibleColumns.map((c) => (
                    <td key={c.key} style={leftAligned(c.key) ? { textAlign: "left", maxWidth: 0 } : { textAlign: "center" }}>
                      {c.render(p, ctx)}
                    </td>
                  ))}
                  <td>
                    <ActionMenu
                      onRename={() => setEditTarget(p)}
                      onEdit={() => setEditTarget(p)}
                      onDuplicate={() => duplicatePool(p)}
                      onDelete={() => setDeleteTarget(p)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length > 0 && <Pager pager={pager} total={filtered.length} noun="pools" />}
      </div>

      {activePool && (
        <>
          <SignalBoard
            key={`signals-${activePool._key}`}
            poolId={activePool._key}
            refreshKey={rlResultId}
            onRefined={(child) => {
              dispatch(fetchRequested());
              selectPool(child._key);
            }}
          />
          <RLTrainingPanel key={activePool._key} pool={activePool} />
          <RefinementHistory poolId={activePool._key} onSelectPool={selectPool} refreshKey={`${rlResultId}-${items.length}`} />
        </>
      )}

      <InfoPanels about={ABOUT} tips={TIPS} />

      <EditPoolModal pool={editTarget} onClose={() => setEditTarget(null)} onSave={saveEdit} />

      <ConfirmDeleteModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        itemName={deleteTarget?.name}
        title="Delete pool"
      />
    </div>
  );
}
