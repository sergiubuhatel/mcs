import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import { apiClient } from "../api/client";
import ActionMenu from "../components/ActionMenu";
import ConfirmDeleteModal from "../components/ConfirmDeleteModal";
import LoadingSpinner from "../components/LoadingSpinner";
import ColumnPicker from "../components/ColumnPicker";
import Modal from "../components/Modal";
import Req from "../components/Req";
import { InfoPanels, PageHeader, SearchBox, SortTh, StatTiles, useSort } from "../components/PageParts";
import { useColumnConfig } from "../utils/useColumnConfig";
import { ClockIcon, LayersIcon, PlusIcon, SaveIcon, SlidersIcon, StarIcon, WorkflowIcon } from "../layout/icons";
import { CRITERIA_PAGES } from "../features/policies/criteriaPageInfo";
import { screenCriteria } from "../features/companies/companiesSaga";
import { KINDS, criteriaDefaults, autoCriteriaName, blankToNull, describeCriteria, nullToBlank, uniqueName } from "../features/policies/criteriaConfig";
import ScreenCriteriaForm from "../features/policies/ScreenCriteriaForm";
import PredictionCriteriaForm from "../features/policies/PredictionCriteriaForm";
import PortfolioCriteriaForm from "../features/policies/PortfolioCriteriaForm";
import { ImportOptionsFields, importOptionsInvalid, parseTickers } from "../features/dataImport/ImportControls";

const apiError = (err) => err.response?.data?.error || err.message;
// Portfolio criteria fields where blank = no limit / auto.
const PORTFOLIO_OPTIONAL = ["max_volatility_pct", "min_return_pct", "max_weight_range_pct", "min_companies", "max_companies"];

// Stored document -> editor state (blank strings for "not set").
function toForm(kind, doc) {
  const defaults = criteriaDefaults();
  const base = { ...defaults[kind], ...(doc || {}) };
  if (kind === "data") return { ...base, tickers: Array.isArray(base.tickers) ? base.tickers.join(", ") : base.tickers || "" };
  if (kind === "prediction") return { ...base, min_change_pct: nullToBlank(base.min_change_pct) };
  if (kind === "portfolio") {
    const out = { ...base, required_tickers: base.required_tickers || [] };
    for (const k of PORTFOLIO_OPTIONAL) out[k] = nullToBlank(out[k]);
    return out;
  }
  return { ...base, filters: { ...defaults.screen.filters, ...(base.filters || {}) } };
}

// Editor state -> API payload.
function toPayload(kind, form) {
  const common = { name: form.name.trim(), description: form.description || "" };
  if (kind === "screen") return { ...common, filters: form.filters, screen: screenCriteria(form.filters) };
  if (kind === "data") {
    const { scope, years, only_missing, import_history, import_statistics, import_calculated_stats } = form;
    return { ...common, scope, tickers: parseTickers(form.tickers), years, only_missing, import_history, import_statistics, import_calculated_stats };
  }
  if (kind === "prediction") {
    return {
      ...common,
      horizons: form.horizons.map((h) => ({ value: Number(h.value), unit: h.unit })),
      training: { value: Number(form.training.value), unit: form.training.unit },
      models: form.models,
      min_change_pct: blankToNull(form.min_change_pct),
      epochs: Number(form.epochs),
      reuse_forecasts: form.reuse_forecasts,
    };
  }
  const out = {
    ...common,
    mode: form.mode,
    trend_window_days: Number(form.trend_window_days),
    risk_aversion: form.risk_aversion,
    timesteps: form.timesteps,
    required_tickers: form.required_tickers || [],
  };
  for (const k of PORTFOLIO_OPTIONAL) out[k] = blankToNull(form[k]);
  return out;
}

function DataCriteriaForm({ value, onChange }) {
  return (
    <div>
      <ImportOptionsFields value={value} onChange={onChange} name="data-criteria-scope" />
      <p className="muted" style={{ margin: 0 }}>
        Runs as step 1 of every policy that uses it; with "only what's missing", a run on already up-to-date data skips the import.
      </p>
    </div>
  );
}

const FORMS = { data: DataCriteriaForm, screen: ScreenCriteriaForm, prediction: PredictionCriteriaForm, portfolio: PortfolioCriteriaForm };

const ellipsis = { display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

const COLUMNS = [
  {
    key: "name",
    label: "Name",
    locked: true,
    width: 340,
    sortable: true,
    render: (c, ctx) => (
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <span className="row-icon"><LayersIcon width={15} height={15} /></span>
        <a onClick={() => ctx.edit(c)} title={c.name} style={{ ...ellipsis, cursor: "pointer", minWidth: 0 }}>{c.name}</a>
        {c.is_default && <span className="default-badge" title="New policies start with this one selected"><StarIcon width={11} height={11} /> Default</span>}
      </div>
    ),
  },
  {
    key: "summary",
    label: "Criteria summary",
    render: (c, ctx) => {
      const text = describeCriteria(ctx.kind, c);
      return <span title={text} className="clamp-2">{text}</span>;
    },
  },
  {
    // Prediction criteria only (see `kinds`): one chip per forecast point.
    key: "horizons",
    label: "Horizons",
    width: 190,
    kinds: ["prediction"],
    render: (c) => (
      <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {(c.horizons || []).map((h) => (
          <span key={`${h.value}${h.unit}`} className="count-badge" title={`${h.value} ${h.unit}`}>
            {h.value}{{ days: "D", weeks: "W", months: "M", years: "Y" }[h.unit]}
          </span>
        ))}
      </span>
    ),
  },
  {
    key: "used",
    label: "Used by",
    width: 110,
    sortable: true,
    render: (c, ctx) => {
      const n = ctx.usage[c._key] || 0;
      return <span className={`count-badge ${n ? "" : "grey"}`} title={n ? `Used by ${n} polic${n === 1 ? "y" : "ies"}` : "Not used by any policy"}>{n} {n === 1 ? "policy" : "policies"}</span>;
    },
  },
  {
    key: "description",
    label: "Description",
    width: 220,
    hiddenByDefault: true,
    render: (c) => <span title={c.description} style={ellipsis}>{c.description}</span>,
  },
  { key: "updated_at", label: "Updated", width: 130, sortable: true, render: (c) => fmtDate(c.updated_at) },
];

function CriteriaGrid({ kind }) {
  const meta = KINDS[kind];
  const Form = FORMS[kind];
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState(null); // { id | null, form, autoName }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [query, setQuery] = useState("");
  const [usage, setUsage] = useState({}); // criteria id -> number of policies using it
  const page = CRITERIA_PAGES[kind];
  const { columns, visibleColumns, hidden, toggleVisible, moveColumn, reset } = useColumnConfig(
    `criteriaGrid.${kind}`,
    COLUMNS.filter((c) => !c.kinds || c.kinds.includes(kind))
  );

  const load = useCallback(() => {
    apiClient
      .get(`/api/criteria/${kind}`)
      .then((r) => setItems(r.data.criteria))
      .catch((err) => toast.error(apiError(err)))
      .finally(() => setLoading(false));
    apiClient
      .get("/api/policies")
      .then((r) => {
        const counts = {};
        for (const p of r.data.policies) {
          const id = p[`${kind}_criteria_id`];
          if (id) counts[id] = (counts[id] || 0) + 1;
        }
        setUsage(counts);
      })
      .catch(() => {});
  }, [kind]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((c) => `${c.name} ${describeCriteria(kind, c)} ${c.description || ""}`.toLowerCase().includes(q));
  }, [items, query, kind]);
  const { sorted, sort, toggle, showNewest } = useSort(filtered, {
    name: (c) => c.name,
    used: (c) => usage[c._key] || 0,
    updated_at: (c) => c.updated_at,
  }, { key: "updated_at", dir: "desc" });

  const setDefault = (c, isDefault) =>
    apiClient
      .post(`/api/criteria/${kind}/${c._key}/default`, { is_default: isDefault })
      .then(() => {
        toast.success(isDefault ? `"${c.name}" is now the default` : "Default removed");
        load();
      })
      .catch((err) => toast.error(apiError(err)));

  useEffect(load, [load]);

  const open = (doc) => {
    setError(null);
    const form = toForm(kind, doc);
    // New criteria are named from their settings until the name is typed over.
    setEditor(doc ? { id: doc._key, form, autoName: false } : { id: null, form: { ...form, name: uniqueName(autoCriteriaName(kind, form), items) }, autoName: true });
  };

  // Every settings change; keeps an automatic name in step with the settings.
  const setForm = (form) =>
    setEditor((ed) => ({ ...ed, form: ed.autoName ? { ...form, name: uniqueName(autoCriteriaName(kind, form), items, ed.id) } : form }));

  // Typing a name switches auto-naming off; clearing it switches it back on.
  const setName = (name) =>
    setEditor((ed) =>
      name.trim()
        ? { ...ed, autoName: false, form: { ...ed.form, name } }
        : { ...ed, autoName: true, form: { ...ed.form, name: uniqueName(autoCriteriaName(kind, ed.form), items, ed.id) } }
    );

  const save = async (e) => {
    e.preventDefault();
    if (!editor.form.name.trim()) {
      setError("Give it a name.");
      return;
    }
    if (kind === "data" && importOptionsInvalid(editor.form)) {
      setError("Fix the import options first.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = toPayload(kind, editor.form);
      if (editor.id) await apiClient.put(`/api/criteria/${kind}/${editor.id}`, payload);
      else await apiClient.post(`/api/criteria/${kind}`, payload);
      toast.success(`Saved "${payload.name}"`);
      if (!editor.id) showNewest(); // newest (last updated) first
      setEditor(null);
      load();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const duplicate = (c) =>
    apiClient
      .post(`/api/criteria/${kind}/${c._key}/duplicate`)
      .then(() => {
        showNewest();
        return load();
      })
      .catch((err) => toast.error(apiError(err)));

  const confirmDelete = () => {
    const target = deleteTarget;
    setDeleteTarget(null);
    apiClient
      .delete(`/api/criteria/${kind}/${target._key}`)
      .then(load)
      .catch((err) => toast.error(apiError(err)));
  };

  const ctx = { kind, edit: open, usage };
  const latest = items.reduce((a, c) => (!a || c.updated_at > a.updated_at ? c : a), null);
  const defaultItem = items.find((c) => c.is_default);
  const usedCount = items.filter((c) => usage[c._key]).length;
  const tiles = [
    { icon: LayersIcon, color: "#8b5cf6", label: "Saved criteria", value: items.length, sub: `${meta.title.toLowerCase()} you can reuse` },
    { icon: ClockIcon, color: "#10b981", label: "Last updated", value: latest ? fmtDate(latest.updated_at) : "–", sub: latest ? latest.name : "nothing saved yet", title: latest?.name },
    { icon: WorkflowIcon, color: "#3b82f6", label: "In use", value: `${usedCount} / ${items.length}`, sub: "used by at least one policy" },
    {
      icon: StarIcon,
      color: "#f59e0b",
      label: "Default",
      value: defaultItem ? defaultItem.name : "None set",
      sub: defaultItem ? "selected for new policies" : "⋯ → Set as default",
      title: defaultItem?.name,
    },
  ];

  return (
    <div>
      <PageHeader icon={SlidersIcon} color={page.color} title={page.title || meta.title} description={page.description} />
      <StatTiles tiles={tiles} />

      <div className="card">
        <div className="card-header" style={{ flexWrap: "wrap" }}>
          <div className="icon-badge" style={{ background: `${page.color}22`, color: page.color }}>
            <LayersIcon width={18} height={18} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3 style={{ margin: 0 }}>Criteria sets</h3>
            <p className="muted" style={{ margin: 0 }}>{meta.blurb}</p>
          </div>
          <div className="toolbar">
            <SearchBox id={`search-${kind}`} value={query} onChange={setQuery} placeholder="Search criteria…" />
            <ColumnPicker columns={columns} hidden={hidden} onToggle={toggleVisible} onMove={moveColumn} onReset={reset} />
            <button className="btn" onClick={() => open(null)}>
              <PlusIcon width={15} height={15} /> New criteria
            </button>
          </div>
        </div>
        {loading && <LoadingSpinner />}
        {!loading && items.length === 0 && <p className="muted">No {meta.singular} yet — click New criteria to create one.</p>}
        {!loading && items.length > 0 && filtered.length === 0 && <p className="muted">Nothing matches "{query}".</p>}
        <table style={{ tableLayout: "fixed", width: "100%" }}>
          <colgroup>
            {visibleColumns.map((c) => <col key={c.key} style={c.width ? { width: c.width } : undefined} />)}
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
                  style={c.key !== "updated_at" ? { textAlign: "left" } : undefined}
                />
              ))}
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((item) => (
              <tr key={item._key}>
                {visibleColumns.map((c) => (
                  <td key={c.key} style={c.key !== "updated_at" ? { textAlign: "left", maxWidth: 0 } : undefined}>{c.render(item, ctx)}</td>
                ))}
                <td>
                  <ActionMenu
                    extraItems={[
                      item.is_default
                        ? { label: "Remove default", icon: StarIcon, onClick: () => setDefault(item, false) }
                        : { label: "Set as default", icon: StarIcon, onClick: () => setDefault(item, true) },
                    ]}
                    onEdit={() => open(item)}
                    onDuplicate={() => duplicate(item)}
                    onDelete={() => setDeleteTarget(item)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <InfoPanels about={page.about} tips={page.tips} />

      <ConfirmDeleteModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        itemName={deleteTarget?.name}
        title={`Delete ${meta.singular}`}
      />

      <Modal
        isOpen={!!editor}
        onClose={() => setEditor(null)}
        title={editor?.id ? `Edit ${meta.singular}` : `New ${meta.singular}`}
        maxWidth={kind === "screen" ? 1100 : 760}
        headerActions={
          <button
            className="close-btn"
            style={{ position: "static", opacity: saving ? 0.5 : 1, cursor: saving ? "not-allowed" : "pointer" }}
            type="submit"
            form="criteria-form"
            disabled={saving}
            title="Save"
            aria-label="Save"
          >
            <SaveIcon width={18} height={18} />
          </button>
        }
      >
        {editor && (
          <form id="criteria-form" onSubmit={save}>
            <div className="filters-grid">
              <div>
                <label>Name<Req /></label>
                <input value={editor.form.name} onChange={(e) => setName(e.target.value)} autoFocus />
                {editor.autoName && <span className="muted">Named automatically from the settings — type to rename.</span>}
              </div>
              <div style={{ gridColumn: "span 2" }}>
                <label>Description</label>
                <input value={editor.form.description} onChange={(e) => setEditor((ed) => ({ ...ed, form: { ...ed.form, description: e.target.value } }))} />
              </div>
            </div>
            {kind === "screen" ? (
              <Form filters={editor.form.filters} onChange={(filters) => setForm({ ...editor.form, filters })} />
            ) : (
              <Form value={editor.form} onChange={setForm} />
            )}
            {error && <p className="error-text">{error}</p>}
          </form>
        )}
      </Modal>
    </div>
  );
}

export default function CriteriaPage() {
  const { kind } = useParams();
  if (!KINDS[kind]) return <Navigate to="/criteria/screen" replace />;
  return <CriteriaGrid key={kind} kind={kind} />;
}
