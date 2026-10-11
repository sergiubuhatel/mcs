import { useCallback, useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import { apiClient } from "../api/client";
import ActionMenu from "../components/ActionMenu";
import ConfirmDeleteModal from "../components/ConfirmDeleteModal";
import LoadingSpinner from "../components/LoadingSpinner";
import ColumnPicker from "../components/ColumnPicker";
import Modal from "../components/Modal";
import Req from "../components/Req";
import { useColumnConfig } from "../utils/useColumnConfig";
import { PlusIcon, SaveIcon } from "../layout/icons";
import { screenCriteria } from "../features/companies/companiesSaga";
import { DEFAULTS, KINDS, autoCriteriaName, blankToNull, describeCriteria, nullToBlank, uniqueName } from "../features/policies/criteriaConfig";
import ScreenCriteriaForm from "../features/policies/ScreenCriteriaForm";
import PredictionCriteriaForm from "../features/policies/PredictionCriteriaForm";
import PortfolioCriteriaForm from "../features/policies/PortfolioCriteriaForm";
import { ImportOptionsFields, importOptionsInvalid, parseTickers } from "../features/dataImport/ImportControls";

const apiError = (err) => err.response?.data?.error || err.message;

// Stored document -> editor state (blank strings for "not set").
function toForm(kind, doc) {
  const base = { ...DEFAULTS[kind], ...(doc || {}) };
  if (kind === "data") return { ...base, tickers: Array.isArray(base.tickers) ? base.tickers.join(", ") : base.tickers || "" };
  if (kind === "prediction") return { ...base, min_change_pct: nullToBlank(base.min_change_pct) };
  if (kind === "portfolio") {
    const out = { ...base };
    for (const k of ["max_volatility_pct", "min_return_pct", "min_companies", "max_companies"]) out[k] = nullToBlank(out[k]);
    return out;
  }
  return { ...base, filters: { ...DEFAULTS.screen.filters, ...(base.filters || {}) } };
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
  const out = { ...common, mode: form.mode, trend_window_days: Number(form.trend_window_days), risk_aversion: form.risk_aversion, timesteps: form.timesteps };
  for (const k of ["max_volatility_pct", "min_return_pct", "min_companies", "max_companies"]) out[k] = blankToNull(form[k]);
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

const COLUMNS = [
  {
    key: "name",
    label: "Name",
    locked: true,
    width: 280,
    render: (c, ctx) => (
      <a onClick={() => ctx.edit(c)} title={c.name} style={{ cursor: "pointer", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {c.name}
      </a>
    ),
  },
  {
    key: "summary",
    label: "Criteria",
    render: (c, ctx) => {
      const text = describeCriteria(ctx.kind, c);
      return <span title={text} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{text}</span>;
    },
  },
  {
    key: "description",
    label: "Description",
    width: 220,
    hiddenByDefault: true,
    render: (c) => <span title={c.description} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.description}</span>,
  },
  { key: "updated_at", label: "Updated", width: 110, render: (c) => new Date(c.updated_at).toLocaleDateString() },
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
  const { columns, visibleColumns, hidden, toggleVisible, moveColumn, reset } = useColumnConfig(`criteriaGrid.${kind}`, COLUMNS);

  const load = useCallback(() => {
    apiClient
      .get(`/api/criteria/${kind}`)
      .then((r) => setItems(r.data.criteria))
      .catch((err) => toast.error(apiError(err)))
      .finally(() => setLoading(false));
  }, [kind]);

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
      .then(load)
      .catch((err) => toast.error(apiError(err)));

  const confirmDelete = () => {
    const target = deleteTarget;
    setDeleteTarget(null);
    apiClient
      .delete(`/api/criteria/${kind}/${target._key}`)
      .then(load)
      .catch((err) => toast.error(apiError(err)));
  };

  const ctx = { kind, edit: open };

  return (
    <div>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <div>
            <h3 style={{ margin: 0 }}>{meta.title}</h3>
            <p className="muted" style={{ margin: 0 }}>{meta.blurb}</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ColumnPicker columns={columns} hidden={hidden} onToggle={toggleVisible} onMove={moveColumn} onReset={reset} />
            <button className="close-btn" style={{ position: "static" }} onClick={() => open(null)} title={`New ${meta.singular}`} aria-label={`New ${meta.singular}`}>
              <PlusIcon width={18} height={18} />
            </button>
          </div>
        </div>
        {loading && <LoadingSpinner />}
        {!loading && items.length === 0 && <p className="muted">No {meta.singular} yet — click + to create one.</p>}
        <table style={{ tableLayout: "fixed", width: "100%" }}>
          <colgroup>
            {visibleColumns.map((c) => <col key={c.key} style={c.width ? { width: c.width } : undefined} />)}
            <col style={{ width: 70 }} />
          </colgroup>
          <thead>
            <tr>
              {visibleColumns.map((c) => <th key={c.key} style={c.key !== "updated_at" ? { textAlign: "left" } : undefined}>{c.label}</th>)}
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item._key}>
                {visibleColumns.map((c) => (
                  <td key={c.key} style={c.key !== "updated_at" ? { textAlign: "left", maxWidth: 0 } : undefined}>{c.render(item, ctx)}</td>
                ))}
                <td>
                  <ActionMenu onEdit={() => open(item)} onDuplicate={() => duplicate(item)} onDelete={() => setDeleteTarget(item)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
                <label>Description (optional)</label>
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
