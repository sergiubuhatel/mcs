import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { apiClient } from "../api/client";
import ActionMenu from "../components/ActionMenu";
import ConfirmDeleteModal from "../components/ConfirmDeleteModal";
import LoadingSpinner from "../components/LoadingSpinner";
import ColumnPicker from "../components/ColumnPicker";
import Modal from "../components/Modal";
import Req from "../components/Req";
import { useColumnConfig } from "../utils/useColumnConfig";
import { PlayIcon, PlusIcon, SaveIcon, StopIcon } from "../layout/icons";
import { KINDS, autoPolicyName, describeCriteria, uniqueName } from "../features/policies/criteriaConfig";
import PolicyRunPanel, { ACTIVE, RunProgress, RunStatus } from "../features/policies/PolicyRunPanel";

const apiError = (err) => err.response?.data?.error || err.message;
const ellipsis = { display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

function criteriaCell(kind) {
  return (p, ctx) => {
    const id = p[`${kind}_criteria_id`];
    if (!id && KINDS[kind].optional) return <span className="muted">none</span>;
    const c = ctx.criteria[kind]?.[id];
    if (!c) return <span className="error-text">missing</span>;
    return (
      <Link to={`/criteria/${kind}`} title={describeCriteria(kind, c)} style={ellipsis}>
        {c.name}
      </Link>
    );
  };
}

const COLUMNS = [
  {
    key: "name",
    label: "Name",
    locked: true,
    width: 240,
    render: (p, ctx) => (
      <a onClick={() => ctx.select(p._key)} title={p.description || p.name} style={{ ...ellipsis, cursor: "pointer" }}>
        {p.name}
      </a>
    ),
  },
  { key: "data", label: "Data Criteria", width: 140, render: criteriaCell("data") },
  { key: "screen", label: "Screening Criteria", width: 170, render: criteriaCell("screen") },
  { key: "prediction", label: "Prediction Criteria", width: 170, render: criteriaCell("prediction") },
  { key: "portfolio", label: "Portfolio Criteria", width: 170, render: criteriaCell("portfolio") },
  {
    key: "status",
    label: "Last run",
    render: (p) => (
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <RunStatus run={p.last_run} />
        {["queued", "running", "failed"].includes(p.last_run?.status) && <div style={{ flex: 1, minWidth: 0 }}><RunProgress run={p.last_run} /></div>}
      </div>
    ),
  },
  {
    key: "result",
    label: "Portfolio",
    width: 90,
    render: (p) => (p.last_run?.portfolio_id ? <Link to={`/portfolios/${p.last_run.portfolio_id}`}>View</Link> : <span className="muted">—</span>),
  },
  { key: "run_at", label: "Run at", width: 150, render: (p) => (p.last_run ? new Date(p.last_run.created_at).toLocaleString() : "—") },
];

const EMPTY = { name: "", description: "", data_criteria_id: "", screen_criteria_id: "", prediction_criteria_id: "", portfolio_criteria_id: "" };

export default function PoliciesPage() {
  const [policies, setPolicies] = useState([]);
  const [criteria, setCriteria] = useState({ data: {}, screen: {}, prediction: {}, portfolio: {} });
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState(null); // { id | null, form, autoName }
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [runKey, setRunKey] = useState(0); // bumps the run panel after Run/Cancel
  const timer = useRef(null);
  const { columns, visibleColumns, hidden, toggleVisible, moveColumn, reset } = useColumnConfig("policiesGrid", COLUMNS);

  const loadPolicies = useCallback(() => {
    clearTimeout(timer.current);
    return apiClient
      .get("/api/policies")
      .then((r) => {
        setPolicies(r.data.policies);
        // Keep the grid's progress live while any policy is running.
        if (r.data.policies.some((p) => ACTIVE.includes(p.last_run?.status))) timer.current = setTimeout(loadPolicies, 2000);
      })
      .catch((err) => toast.error(apiError(err)))
      .finally(() => setLoading(false));
  }, []);

  const loadCriteria = useCallback(
    () =>
      Promise.all(Object.keys(KINDS).map((k) => apiClient.get(`/api/criteria/${k}`))).then((res) =>
        setCriteria(Object.fromEntries(Object.keys(KINDS).map((k, i) => [k, Object.fromEntries(res[i].data.criteria.map((c) => [c._key, c]))])))
      ),
    []
  );

  useEffect(() => {
    loadPolicies();
    loadCriteria();
    return () => clearTimeout(timer.current);
  }, [loadPolicies, loadCriteria]);

  // "Screen → Prediction → Portfolio" from the picked criteria's names.
  const generatedName = (form, id) => {
    const name = autoPolicyName(Object.fromEntries(Object.keys(KINDS).map((k) => [k, criteria[k][form[`${k}_criteria_id`]]])));
    return uniqueName(name || "New policy", policies, id);
  };

  const open = (p) => {
    setError(null);
    loadCriteria();
    if (p) {
      setEditor({ id: p._key, form: { ...EMPTY, ...p }, autoName: false });
      return;
    }
    // A new policy starts with the only criteria of a kind when there's just one.
    const form = { ...EMPTY };
    for (const k of Object.keys(KINDS)) {
      const options = Object.keys(criteria[k]);
      if (options.length === 1) form[`${k}_criteria_id`] = options[0];
    }
    setEditor({ id: null, form: { ...form, name: generatedName(form, null) }, autoName: true });
  };

  const save = async (e) => {
    e.preventDefault();
    const payload = { name: editor.form.name.trim(), description: editor.form.description };
    for (const k of Object.keys(KINDS)) payload[`${k}_criteria_id`] = editor.form[`${k}_criteria_id`];
    setSaving(true);
    setError(null);
    try {
      if (editor.id) await apiClient.put(`/api/policies/${editor.id}`, payload);
      else await apiClient.post("/api/policies", payload);
      toast.success(`Saved "${payload.name}"`);
      setEditor(null);
      loadPolicies();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const run = (p) =>
    apiClient
      .post(`/api/policies/${p._key}/run`)
      .then(() => {
        toast.info(`Running "${p.name}"`);
        setActiveId(p._key);
        setRunKey((k) => k + 1);
        loadPolicies();
      })
      .catch((err) => toast.error(apiError(err)));

  const cancel = (p) =>
    apiClient
      .post(`/api/policies/runs/${p.last_run._key}/cancel`)
      .then(() => {
        setRunKey((k) => k + 1);
        loadPolicies();
      })
      .catch((err) => toast.error(apiError(err)));

  const duplicate = (p) =>
    apiClient
      .post(`/api/policies/${p._key}/duplicate`)
      .then(loadPolicies)
      .catch((err) => toast.error(apiError(err)));

  const confirmDelete = () => {
    const target = deleteTarget;
    setDeleteTarget(null);
    apiClient
      .delete(`/api/policies/${target._key}`)
      .then(() => {
        if (activeId === target._key) setActiveId(null);
        loadPolicies();
      })
      .catch((err) => toast.error(apiError(err)));
  };

  const ctx = { criteria, select: setActiveId };
  const activePolicy = policies.find((p) => p._key === activeId);
  const setField = (k, v) =>
    setEditor((ed) => {
      const form = { ...ed.form, [k]: v };
      return { ...ed, form: ed.autoName ? { ...form, name: generatedName(form, ed.id) } : form };
    });

  // Typing a name switches auto-naming off; clearing it switches it back on.
  const setName = (name) =>
    setEditor((ed) =>
      name.trim()
        ? { ...ed, autoName: false, form: { ...ed.form, name } }
        : { ...ed, autoName: true, form: { ...ed.form, name: generatedName(ed.form, ed.id) } }
    );

  return (
    <div>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <div>
            <h3 style={{ margin: 0 }}>Policies</h3>
            <p className="muted" style={{ margin: 0 }}>
              Run = import with the data criteria → search by the screen criteria → forecast and filter by the prediction criteria → build the RL portfolio with the portfolio criteria.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ColumnPicker columns={columns} hidden={hidden} onToggle={toggleVisible} onMove={moveColumn} onReset={reset} />
            <button className="close-btn" style={{ position: "static" }} onClick={() => open(null)} title="New policy" aria-label="New policy">
              <PlusIcon width={18} height={18} />
            </button>
          </div>
        </div>
        {loading && <LoadingSpinner />}
        {!loading && policies.length === 0 && <p className="muted">No policies yet — click + to create one.</p>}
        <table style={{ tableLayout: "fixed", width: "100%" }}>
          <colgroup>
            {visibleColumns.map((c) => <col key={c.key} style={c.width ? { width: c.width } : undefined} />)}
            <col style={{ width: 70 }} />
          </colgroup>
          <thead>
            <tr>
              {visibleColumns.map((c) => <th key={c.key} style={c.key !== "run_at" ? { textAlign: "left" } : undefined}>{c.label}</th>)}
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {policies.map((p) => {
              const active = ACTIVE.includes(p.last_run?.status);
              return (
                <tr key={p._key} style={p._key === activeId ? { background: "var(--color-bg-tertiary)" } : undefined}>
                  {visibleColumns.map((c) => (
                    <td key={c.key} style={c.key !== "run_at" ? { textAlign: "left", maxWidth: 0 } : undefined}>{c.render(p, ctx)}</td>
                  ))}
                  <td>
                    <ActionMenu
                      extraItems={[
                        active
                          ? { label: "Cancel run", icon: StopIcon, onClick: () => cancel(p) }
                          : { label: "Run", icon: PlayIcon, onClick: () => run(p) },
                      ]}
                      onEdit={() => open(p)}
                      onDuplicate={() => duplicate(p)}
                      onDelete={() => setDeleteTarget(p)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {activePolicy && (
        <PolicyRunPanel policy={activePolicy} refreshKey={runKey} onClose={() => setActiveId(null)} onChanged={loadPolicies} />
      )}

      <ConfirmDeleteModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        itemName={deleteTarget?.name}
        title="Delete policy"
      />

      <Modal
        isOpen={!!editor}
        onClose={() => setEditor(null)}
        title={editor?.id ? "Edit policy" : "New policy"}
        maxWidth={620}
        headerActions={
          <button
            className="close-btn"
            style={{ position: "static", opacity: saving ? 0.5 : 1, cursor: saving ? "not-allowed" : "pointer" }}
            type="submit"
            form="policy-form"
            disabled={saving}
            title="Save"
            aria-label="Save"
          >
            <SaveIcon width={18} height={18} />
          </button>
        }
      >
        {editor && (
          <form id="policy-form" onSubmit={save} className="filters-grid" style={{ gridTemplateColumns: "1fr" }}>
            <div>
              <label>Name<Req /></label>
              <input value={editor.form.name} onChange={(e) => setName(e.target.value)} autoFocus />
              {editor.autoName && <span className="muted">Named automatically from the criteria — type to rename.</span>}
            </div>
            <div>
              <label>Description</label>
              <input value={editor.form.description} onChange={(e) => setField("description", e.target.value)} />
            </div>
            {Object.entries(KINDS).map(([kind, meta]) => {
              const options = Object.values(criteria[kind]);
              const field = `${kind}_criteria_id`;
              const chosen = criteria[kind][editor.form[field]];
              return (
                <div key={kind}>
                  <label>{meta.title}{!meta.optional && <Req />}</label>
                  <select value={editor.form[field]} onChange={(e) => setField(field, e.target.value)}>
                    <option value="">{meta.optional ? "— none (don't import, use the stored data) —" : "— pick one —"}</option>
                    {options.map((c) => <option key={c._key} value={c._key}>{c.name}</option>)}
                  </select>
                  <p className="muted" style={{ margin: "3px 0 0" }}>
                    {chosen ? describeCriteria(kind, chosen) : meta.optional ? (
                      "Without one, the run screens and forecasts on the data already imported."
                    ) : options.length === 0 ? (
                      <>None yet — <Link to={`/criteria/${kind}`}>create {meta.singular}</Link>.</>
                    ) : meta.blurb}
                  </p>
                </div>
              );
            })}
            {error && <p className="error-text">{error}</p>}
          </form>
        )}
      </Modal>
    </div>
  );
}
