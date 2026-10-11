import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { apiClient } from "../api/client";
import ActionMenu from "../components/ActionMenu";
import ConfirmDeleteModal from "../components/ConfirmDeleteModal";
import LoadingSpinner from "../components/LoadingSpinner";
import ColumnPicker from "../components/ColumnPicker";
import Modal from "../components/Modal";
import Req from "../components/Req";
import { PageHeader, Pager, SearchBox, SortTh, useSort, usePager } from "../components/PageParts";
import { useColumnConfig } from "../utils/useColumnConfig";
import { EyeIcon, ListIcon, PlayIcon, PlusIcon, SaveIcon, StopIcon, WorkflowIcon } from "../layout/icons";
import { KINDS, autoPolicyName, describeCriteria, uniqueName } from "../features/policies/criteriaConfig";
import PolicyRunPanel, { ACTIVE, KIND_STYLE, RunProgress, RunStatus } from "../features/policies/PolicyRunPanel";

const apiError = (err) => err.response?.data?.error || err.message;
const ellipsis = { display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

const PAGE_SIZE = 10;
const STATUS_FILTERS = { all: "All", never: "Never run", active: "Running", succeeded: "Succeeded", failed: "Failed", cancelled: "Cancelled" };

function runState(p) {
  const st = p.last_run?.status;
  if (!st) return "never";
  return ACTIVE.includes(st) ? "active" : st;
}

function criteriaCell(kind) {
  return (p, ctx) => {
    const { icon: Icon, color } = KIND_STYLE[kind];
    const id = p[`${kind}_criteria_id`];
    if (!id && KINDS[kind].optional) {
      return (
        <span className="crit-chip none" title="No data criteria: the run uses the data already stored">
          <Icon width={13} height={13} /> None
        </span>
      );
    }
    const c = ctx.criteria[kind]?.[id];
    if (!c) return <span className="error-text">missing</span>;
    return (
      <Link to={`/criteria/${kind}`} className="crit-chip" title={`${c.name}\n${describeCriteria(kind, c)}`}>
        <Icon width={13} height={13} style={{ color }} />
        <span className="crit-chip-label">{c.name}</span>
      </Link>
    );
  };
}

const COLUMNS = [
  {
    key: "name",
    label: "Name",
    locked: true,
    width: 200,
    sortable: true,
    render: (p, ctx) => (
      <a onClick={() => ctx.select(p._key)} title={p.description || p.name} style={{ ...ellipsis, cursor: "pointer" }}>
        {p.name}
      </a>
    ),
  },
  { key: "data", label: "Data Criteria", width: 125, render: criteriaCell("data") },
  { key: "screen", label: "Screening Criteria", width: 135, render: criteriaCell("screen") },
  { key: "prediction", label: "Prediction Criteria", width: 135, render: criteriaCell("prediction") },
  { key: "portfolio", label: "Portfolio Criteria", render: criteriaCell("portfolio") },
  {
    key: "status",
    label: "Status",
    width: 210,
    sortable: true,
    render: (p) => (
      <div className="status-cell">
        <RunStatus run={p.last_run} />
        {["queued", "running", "failed"].includes(p.last_run?.status) && <RunProgress run={p.last_run} />}
      </div>
    ),
  },
  {
    key: "result",
    label: "Portfolio",
    width: 75,
    render: (p) => (p.last_run?.portfolio_id ? <Link to={`/portfolios/${p.last_run.portfolio_id}`}>Open</Link> : <span className="muted">—</span>),
  },
  { key: "run_at", label: "Last run", width: 165, sortable: true, render: (p) => (p.last_run ? new Date(p.last_run.created_at).toLocaleString() : "—") },
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
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState({ data: "", screen: "", prediction: "", portfolio: "", status: "all" }); // "" = all, "none" = no data criteria
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
    // A new policy starts with each kind's default criteria, or with the
    // only one when there's just one. Data criteria stays optional: only a
    // default pre-selects it.
    const form = { ...EMPTY };
    for (const k of Object.keys(KINDS)) {
      const options = Object.values(criteria[k]);
      const preset = options.find((c) => c.is_default) || (options.length === 1 && !KINDS[k].optional ? options[0] : null);
      if (preset) form[`${k}_criteria_id`] = preset._key;
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return policies.filter((p) => {
      for (const k of Object.keys(KINDS)) {
        const want = filters[k];
        if (!want) continue;
        const id = p[`${k}_criteria_id`] || "";
        if (want === "none" ? id !== "" : id !== want) return false;
      }
      if (filters.status !== "all" && runState(p) !== filters.status) return false;
      if (!q) return true;
      const names = Object.keys(KINDS).map((k) => criteria[k][p[`${k}_criteria_id`]]?.name || "").join(" ");
      return `${p.name} ${p.description || ""} ${names}`.toLowerCase().includes(q);
    });
  }, [policies, filters, query, criteria]);
  const { sorted, sort, toggle } = useSort(
    filtered,
    { name: (p) => p.name, status: (p) => runState(p), run_at: (p) => p.last_run?.created_at },
    { key: "run_at", dir: "desc" }
  );
  const pager = usePager(sorted, PAGE_SIZE);
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  const filtersOn = query.trim() || filters.status !== "all" || Object.keys(KINDS).some((k) => filters[k]);
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
      <div className="card header-card">
        <PageHeader
          icon={WorkflowIcon}
          color="#8b5cf6"
          title="Policies"
          description="Saved import → screening → prediction → portfolio recipes. Run a policy to build a portfolio automatically."
        />
        <div className="toolbar">
          <ColumnPicker columns={columns} hidden={hidden} onToggle={toggleVisible} onMove={moveColumn} onReset={reset} />
          <button className="btn" onClick={() => open(null)}>
            <PlusIcon width={17} height={17} /> New policy
          </button>
        </div>
      </div>

      <div className="card filter-card">
        <SearchBox id="search-policies" value={query} onChange={setQuery} placeholder="Search policies by name, criteria or description…" />
        <div className="filter-row">
          {Object.entries(KINDS).map(([kind, meta]) => {
            const { icon: Icon, color } = KIND_STYLE[kind];
            return (
              <div key={kind} className="filter-field boxed">
                <label htmlFor={`filter-${kind}`}><Icon width={14} height={14} style={{ color }} /> {meta.title}</label>
                <select id={`filter-${kind}`} value={filters[kind]} onChange={(e) => setFilter(kind, e.target.value)}>
                  <option value="">All</option>
                  {meta.optional && <option value="none">None</option>}
                  {Object.values(criteria[kind]).map((c) => <option key={c._key} value={c._key}>{c.name}</option>)}
                </select>
              </div>
            );
          })}
          <div className="filter-field boxed">
            <label htmlFor="filter-status"><ListIcon width={14} height={14} /> Status</label>
            <select id="filter-status" value={filters.status} onChange={(e) => setFilter("status", e.target.value)}>
              {Object.entries(STATUS_FILTERS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        {loading && <LoadingSpinner />}
        {!loading && policies.length === 0 && <p className="muted">No policies yet — click New policy to create one.</p>}
        {!loading && policies.length > 0 && filtered.length === 0 && (
          <p className="muted">
            No policy matches these filters.{" "}
            <a style={{ cursor: "pointer" }} onClick={() => { setQuery(""); setFilters({ data: "", screen: "", prediction: "", portfolio: "", status: "all" }); }}>Clear filters</a>
          </p>
        )}
        <table style={{ tableLayout: "fixed", width: "100%" }}>
          <colgroup>
            {visibleColumns.map((c) => <col key={c.key} style={c.width ? { width: c.width } : undefined} />)}
            <col style={{ width: 130 }} />
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
                  style={c.key !== "run_at" ? { textAlign: "left" } : undefined}
                />
              ))}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {pager.rows.map((p) => {
              const active = ACTIVE.includes(p.last_run?.status);
              return (
                <tr key={p._key} className={p._key === activeId ? "selected" : ""}>
                  {visibleColumns.map((c) => (
                    <td key={c.key} style={c.key !== "run_at" ? { textAlign: "left", maxWidth: 0 } : undefined}>{c.render(p, ctx)}</td>
                  ))}
                  <td>
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
                      <button className="btn secondary btn-sm" onClick={() => setActiveId(p._key)} title="Show the last run and run history">
                        <EyeIcon width={14} height={14} /> View
                      </button>
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
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length > 0 && <Pager pager={pager} total={filtered.length} noun={filtersOn ? "matching policies" : "policies"} />}
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
