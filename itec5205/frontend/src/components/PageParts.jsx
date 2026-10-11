// Building blocks shared by the list pages (criteria, pools, market data):
// page header, stat tiles, toolbar search, sortable headers, pager, and the
// About / Quick tips panels at the bottom.
import { useMemo, useState } from "react";
import BackButton from "../layout/BackButton";
import { LightbulbIcon, SearchIcon } from "../layout/icons";

/** Page title row; `actions` (e.g. New buttons) sit right, just before the back X. */
export function PageHeader({ icon: Icon, color = "#3b82f6", title, description, breadcrumb, actions }) {
  return (
    <header className="page-header">
      <div className="icon-badge page-header-icon" style={{ background: `${color}26`, color }}>
        <Icon width={28} height={28} />
      </div>
      <div style={{ minWidth: 0 }}>
        {breadcrumb && (
          <nav className="breadcrumb" aria-label="Breadcrumb">
            {breadcrumb.map((b, i) => (
              <span key={b} style={{ display: "contents" }}>
                {i > 0 && <span aria-hidden="true">›</span>}
                <span>{b}</span>
              </span>
            ))}
          </nav>
        )}
        <h2 style={{ margin: 0 }}>{title}</h2>
        <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>{description}</p>
      </div>
      <div className="page-header-actions">
        {actions}
        <BackButton />
      </div>
    </header>
  );
}

/** Row of summary tiles: [{icon, color, label, value, sub}]. */
export function StatTiles({ tiles }) {
  return (
    <div className="stat-row">
      {tiles.map(({ icon: Icon, color, label, value, sub, title }) => (
        <div key={label} className="stat-card" title={title}>
          <div className="icon-badge stat-card-icon" style={{ background: `${color}22`, color }}>
            <Icon width={24} height={24} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="stat-card-label">{label}</div>
            <div className="stat-card-value">{value}</div>
            <div className="muted stat-card-sub">{sub}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder, id }) {
  return (
    <label className="search-box" htmlFor={id}>
      <SearchIcon width={15} height={15} />
      <input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  );
}

/** Client-side sort: `getters` maps a column key to a value function. */
export function useSort(items, getters, initial = { key: null, dir: "asc" }) {
  const [sort, setSort] = useState(initial);
  const sorted = useMemo(() => {
    const get = getters[sort.key];
    if (!get) return items;
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...items].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (va == null) return 1;
      if (vb == null) return -1;
      return (typeof va === "string" ? va.localeCompare(vb) : va - vb) * factor;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, sort]);
  const toggle = (key) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" ? "asc" : "desc" }));
  return { sorted, sort, toggle };
}

/** Column header; clickable with an arrow when `sortable`. */
export function SortTh({ label, colKey, sort, onSort, sortable, style }) {
  if (!sortable) return <th style={style}>{label}</th>;
  const active = sort.key === colKey;
  return (
    <th style={style} className={active ? "sorted" : ""} onClick={() => onSort(colKey)} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        {label}
        <span className="sort-arrow" aria-hidden="true">{active ? (sort.dir === "asc" ? "↑" : "↓") : "↕"}</span>
      </span>
    </th>
  );
}

export function usePager(items, pageSize) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, pages);
  const start = (current - 1) * pageSize;
  return { rows: items.slice(start, start + pageSize), page: current, pages, setPage, from: items.length ? start + 1 : 0, to: Math.min(start + pageSize, items.length) };
}

export function Pager({ pager, total, noun }) {
  const { page, pages, setPage, from, to } = pager;
  return (
    <div className="pager">
      <span className="muted">Showing {from}–{to} of {total} {noun}</span>
      {pages > 1 && (
        <span style={{ display: "inline-flex", gap: 4 }}>
          <button className="pager-btn" onClick={() => setPage(page - 1)} disabled={page === 1} aria-label="Previous page">‹</button>
          {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
            <button key={n} className={`pager-btn ${n === page ? "active" : ""}`} onClick={() => setPage(n)} aria-current={n === page ? "page" : undefined}>
              {n}
            </button>
          ))}
          <button className="pager-btn" onClick={() => setPage(page + 1)} disabled={page === pages} aria-label="Next page">›</button>
        </span>
      )}
    </div>
  );
}

/** "About" card with feature tiles + "Quick tips" card with numbered steps. */
export function InfoPanels({ about, tips }) {
  const AboutIcon = about.icon;
  return (
    <div className="info-grid">
      <div className="card" style={{ minWidth: 0 }}>
        <div className="card-header" style={{ alignItems: "flex-start" }}>
          <div className="icon-badge" style={{ background: `${about.color}22`, color: about.color, width: 44, height: 44 }}>
            <AboutIcon width={22} height={22} />
          </div>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0 }}>{about.title}</h3>
            <p className="muted" style={{ margin: 0, maxWidth: "75ch" }}>{about.text}</p>
          </div>
        </div>
        <div className="feature-grid">
          {about.features.map(({ icon: Icon, color, title, text }) => (
            <div key={title} className="feature">
              <div className="icon-badge" style={{ background: `${color}22`, color }}>
                <Icon width={18} height={18} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="tip-title">{title}</div>
                <div className="muted">{text}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="card" style={{ minWidth: 0 }}>
        <div className="card-header">
          <div className="icon-badge" style={{ background: "#3b82f622", color: "#3b82f6" }}>
            <LightbulbIcon width={18} height={18} />
          </div>
          <h3 style={{ margin: 0 }}>Quick tips</h3>
        </div>
        <ol className="tip-steps">
          {tips.map(({ title, text }, i) => (
            <li key={title} className="tip-row">
              <span className="tip-step">{i + 1}</span>
              <div style={{ minWidth: 0 }}>
                <div className="tip-title">{title}</div>
                <div className="muted">{text}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/** One-row "Quick tips" strip: [{title, text}] as numbered steps. */
export function QuickTipsBar({ title = "Quick tips", subtitle, tips }) {
  return (
    <div className="card tips-bar">
      <div className="card-header" style={{ marginBottom: 0 }}>
        <div className="icon-badge" style={{ background: "#3b82f622", color: "#3b82f6" }}>
          <LightbulbIcon width={18} height={18} />
        </div>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          {subtitle && <p className="muted" style={{ margin: 0 }}>{subtitle}</p>}
        </div>
      </div>
      {tips.map(({ title: t, text }, i) => (
        <div key={t} className="tips-bar-step">
          <span className="tip-step round">{i + 1}</span>
          <div style={{ minWidth: 0 }}>
            <div className="tip-title">{t}</div>
            <div className="muted">{text}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
