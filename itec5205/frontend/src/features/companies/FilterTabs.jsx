import { useEffect, useRef, useState } from "react";
import { InfoIcon } from "../../layout/icons";
import { FILTER_TABS, activeFilters, tabFields, tabGroups } from "./filterFields";

const filled = (v) => v !== "" && v !== null && v !== undefined;

function readTab(storageKey) {
  try {
    const id = localStorage.getItem(storageKey);
    return FILTER_TABS.some((t) => t.id === id) ? id : "fundamentals";
  } catch {
    return "fundamentals";
  }
}

/** A tab's field columns: one per group, or a lone group's fields split
 * into up to three untitled columns so the inputs don't stretch full width. */
function columns(tab) {
  const groups = tabGroups(tab);
  if (groups.length > 1) return groups.map((g) => ({ ...g, key: g.title }));
  const fields = groups[0]?.fields || [];
  const per = Math.max(2, Math.ceil(fields.length / 3));
  const out = [];
  for (let i = 0; i < fields.length; i += per) out.push({ key: `c${i}`, fields: fields.slice(i, i + per) });
  return out;
}

/** The (i) next to a filter label: what it is and a recommended value. */
function InfoTip({ field }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (e.type === "keydown" ? e.key === "Escape" : !ref.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  if (!field.hint && !field.tip) return null;
  return (
    <span className="ft-info" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`About ${field.label}`} title="What is this?">
        <InfoIcon width={14} height={14} />
      </button>
      {open && (
        <span className="ft-pop" role="tooltip">
          <strong>{field.label}</strong>
          {field.hint && <span>{field.hint}.</span>}
          {field.tip && <span className="ft-tip"><b>Recommended:</b> {field.tip}</span>}
        </span>
      )}
    </span>
  );
}

/**
 * The screener's metric filters as tabs (Overview, Fundamentals, ...), shared
 * by the Stock Screener and the Screening Criteria editor. `filters` has the
 * screener's shape; `renderInputs(field)` draws that field's min / max (and
 * unit picker), since the two forms keep unit values differently.
 */
export default function FilterTabs({ filters, renderInputs, storageKey = "screenerFilterTab" }) {
  const [tabId, setTabId] = useState(() => readTab(storageKey));
  const tab = FILTER_TABS.find((t) => t.id === tabId);
  const pick = (id) => {
    setTabId(id);
    try {
      localStorage.setItem(storageKey, id);
    } catch {
      // a remembered tab is only a convenience
    }
  };

  const keysOf = (t) => new Set(tabFields(t).map((f) => f.key));
  const count = (t) => tabFields(t).filter(({ key }) => (filters.ranges?.[key] || []).some(filled)).length;
  const metricTabs = FILTER_TABS.filter((t) => t.id !== "overview");
  const total = metricTabs.reduce((n, t) => n + count(t), 0);
  const chips = activeFilters(filters);
  const Icon = tab.icon;

  return (
    <div className="ft">
      <div className="ft-tabs" role="tablist">
        {FILTER_TABS.map((t) => {
          const TabIcon = t.icon;
          const n = t.id === "overview" ? total : count(t);
          return (
            <button key={t.id} type="button" role="tab" aria-selected={t.id === tabId} className={`ft-tab${t.id === tabId ? " active" : ""}`} onClick={() => pick(t.id)}>
              <TabIcon width={18} height={18} />
              {t.title}
              {n > 0 && <span className="count-badge on" title={`${n} active filter${n === 1 ? "" : "s"}`}>{n}</span>}
            </button>
          );
        })}
      </div>

      <div className="ft-panel" role="tabpanel">
        <div className="ft-head">
          <span className="icon-badge" style={{ width: 40, height: 40, background: `${tab.color}26`, color: tab.color }}>
            <Icon width={20} height={20} />
          </span>
          <div>
            <h3>{tab.heading}</h3>
            <p className="muted">{tab.subtitle}</p>
          </div>
        </div>

        {tab.id === "overview" ? (
          <div className="ft-overview">
            {metricTabs.map((t) => {
              const TabIcon = t.icon;
              const keys = keysOf(t);
              const set = chips.filter((c) => keys.has(c.field));
              return (
                <button key={t.id} type="button" className="ft-overview-card" onClick={() => pick(t.id)} title={`Open ${t.title}`}>
                  <span className="icon-badge" style={{ width: 30, height: 30, background: `${t.color}26`, color: t.color }}>
                    <TabIcon width={16} height={16} />
                  </span>
                  <span className="ft-overview-body">
                    <span className="ft-overview-title">
                      {t.title}
                      <span className={`count-badge ${set.length ? "on" : ""}`}>{set.length}</span>
                    </span>
                    <span className="ft-overview-chips">
                      {set.length ? set.map((c) => <span key={c.id} className="filter-chip">{c.label}</span>) : <span className="muted">No filters</span>}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="ft-cols">
            {columns(tab).map((g) => (
              <div key={g.key} className="ft-col">
                {g.title && <div className="ft-group-title" style={{ color: g.color }}>{g.title}</div>}
                {g.fields.map((f) => (
                  <div key={f.key} className="ft-row">
                    <div className="ft-label">
                      <span>{f.unit ? `${f.label} ($)` : f.label}</span>
                      <InfoTip field={f} />
                    </div>
                    <div className="ft-inputs">{renderInputs(f)}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
