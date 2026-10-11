import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../../api/client";
import {
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  CloseIcon,
  DatabaseIcon,
  PieChartIcon,
  SearchIcon,
  SpinnerIcon,
  TrendChartIcon,
  WorkflowIcon,
  XCircleIcon,
} from "../../layout/icons";

export const ACTIVE = ["queued", "running"];

// Same icon + color per criteria kind as its sidebar group.
export const KIND_STYLE = {
  data: { icon: DatabaseIcon, color: "#10b981" },
  screen: { icon: SearchIcon, color: "#3b82f6" },
  prediction: { icon: TrendChartIcon, color: "#06b6d4" },
  portfolio: { icon: PieChartIcon, color: "#22c55e" },
};

const STATUS_LABELS = { succeeded: "Succeeded", failed: "Failed", cancelled: "Cancelled", running: "Running", queued: "Queued" };
const STATUS_TONES = { succeeded: "good", failed: "bad", cancelled: "grey", running: "info", queued: "info" };
const STATUS_MARKS = { succeeded: "✓", failed: "✕", cancelled: "–", running: "●", queued: "…" };

export function RunStatus({ run }) {
  if (!run) return <span className="muted">Never run</span>;
  return (
    <span className={`status-pill ${STATUS_TONES[run.status] || "info"}`} style={{ justifySelf: "start" }}>
      {STATUS_MARKS[run.status] ? `${STATUS_MARKS[run.status]} ` : ""}
      {STATUS_LABELS[run.status] || run.status}
    </span>
  );
}

/** One-line progress for the grid: bar + "Step 2 of 3 · message". */
export function RunProgress({ run }) {
  if (!run || run.status === "cancelled") return <span className="muted">—</span>;
  const active = ACTIVE.includes(run.status);
  return (
    <div style={{ minWidth: 0, flex: 1 }}>
      {active && (
        <div className="progress-bar thin">
          <div style={{ width: `${run.percent || 0}%` }} />
        </div>
      )}
      <span
        className={run.status === "failed" ? "error-text" : "muted"}
        title={run.message}
        style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.72rem" }}
      >
        {active && `Step ${run.step_index} of ${run.steps_total} · `}
        {run.message}
      </span>
    </div>
  );
}

const fmtPct = (v) => (v === null || v === undefined ? "-" : `${(Number(v) * 100).toFixed(2)}%`);
const changeColor = (v) => (v == null || v === 0 ? "var(--color-text-primary)" : v > 0 ? "#16a34a" : "#dc2626");

const STEPS = [
  { key: "data", kind: "data", title: "1. Data Import", waiting: "Import with the data criteria" },
  { key: "screen", kind: "screen", title: "2. Screening", waiting: "Search by the screen criteria" },
  { key: "forecast", kind: "prediction", title: "3. Prediction", waiting: "Forecast and filter by the prediction criteria" },
  { key: "portfolio", kind: "portfolio", title: "4. Portfolio Optimization", waiting: "Build the portfolio with the portfolio criteria" },
];

const STEP_STATES = {
  done: { label: "Completed", color: "#16a34a", icon: CheckCircleIcon },
  failed: { label: "Failed", color: "#dc2626", icon: XCircleIcon },
  running: { label: "Running", color: "var(--color-text-accent)", icon: SpinnerIcon, spin: true },
  waiting: { label: "Waiting", color: "var(--color-text-secondary)" },
  skipped: { label: "Skipped", color: "var(--color-text-secondary)" },
};

function StepCard({ step, data, run }) {
  const status = data?.status || (ACTIVE.includes(run.status) ? "waiting" : "skipped");
  const current = run.step === step.key && ACTIVE.includes(run.status);
  const state = STEP_STATES[current ? "running" : status] || STEP_STATES.waiting;
  const { icon: KindIcon, color } = KIND_STYLE[step.kind];
  let body = step.waiting;
  if (step.key === "data" && data?.requested != null) {
    if (data.status === "done") {
      body = data.imported ? `Imported ${data.imported}${data.failed ? `, ${data.failed} failed` : ""}` : "Nothing to import";
      if (data.up_to_date) body += ` · ${data.up_to_date} already up to date`;
    } else if (data.total) body = `Importing ${data.completed}/${data.total}${data.up_to_date ? ` · ${data.up_to_date} up to date` : ""}`;
  }
  if (step.key === "data" && status === "skipped") body = "No data criteria — used the data already stored";
  if (step.key === "screen" && data?.tickers != null) body = `${data.tickers} companies matched`;
  if (step.key === "forecast" && data?.counts) {
    body = Object.entries(data.counts)
      .map(([m, c]) => `${m.toUpperCase()} ${c.done + c.failed}/${c.total}${c.reused ? ` (+${c.reused} reused)` : ""}${c.failed ? `, ${c.failed} failed` : ""}`)
      .join(" · ");
    if (data.passed != null) body += ` → ${data.passed} passed`;
  }
  if (step.key === "portfolio" && data?.portfolio_id) {
    body = `${data.holdings} companies · return ${fmtPct(data.metrics?.annual_return)} · volatility ${fmtPct(data.metrics?.expected_volatility)}`;
  } else if (current && step.key !== "data") body = run.message;
  const StateIcon = state.icon;
  return (
    <div className={`step-card ${current ? "current" : ""}`}>
      <div className="icon-badge" style={{ background: `${color}22`, color, width: 44, height: 44 }}>
        <KindIcon width={22} height={22} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="step-card-title">{step.title}</div>
        <div className="muted step-card-body" title={typeof body === "string" ? body : undefined}>{body}</div>
      </div>
      <div className="step-card-state" style={{ color: state.color }}>
        {StateIcon ? <StateIcon width={24} height={24} className={state.spin ? "spin" : undefined} /> : <span style={{ height: 24 }} />}
        <span>{state.label}</span>
      </div>
    </div>
  );
}

function ForecastTable({ rows }) {
  if (!rows?.length) return null;
  const models = Object.keys(rows[0].models);
  const points = Object.keys(Object.values(rows[0].models).find(Boolean)?.changes || {});
  return (
    <div className="forecast-table">
      <table className="compact">
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Ticker</th>
            <th style={{ textAlign: "left" }}>Result</th>
            {models.flatMap((m) => points.map((p) => <th key={`${m}${p}`} style={{ textAlign: "center" }}>{m.toUpperCase()} {p}</th>))}
          </tr>
        </thead>
        <tbody>
          {[...rows]
            .sort((a, b) => Number(b.passed) - Number(a.passed) || a.ticker.localeCompare(b.ticker))
            .map((r) => (
              <tr key={r.ticker}>
                <td style={{ textAlign: "left" }}><Link to={`/companies/${r.ticker}`}>{r.ticker}</Link></td>
                <td style={{ textAlign: "left", color: r.passed ? "#16a34a" : "#dc2626" }} title={r.reason || ""}>{r.passed ? "passed" : r.reason}</td>
                {models.flatMap((m) =>
                  points.map((p) => {
                    const v = r.models[m]?.changes?.[p];
                    return (
                      <td key={`${m}${p}`} style={{ textAlign: "center", color: changeColor(v) }}>
                        {v == null ? "-" : `${v > 0 ? "+" : ""}${v.toFixed(2)}%`}
                      </td>
                    );
                  })
                )}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

/** Latest run of a policy (live while it's active) + its run history. */
export default function PolicyRunPanel({ policy, refreshKey, onClose, onChanged }) {
  const [runs, setRuns] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      apiClient.get(`/api/policies/${policy._key}/runs`).then((r) => {
        if (!alive) return;
        setRuns(r.data.runs);
        if (r.data.runs.some((x) => ACTIVE.includes(x.status))) timer.current = setTimeout(load, 2000);
        else onChanged?.();
      });
    load();
    return () => {
      alive = false;
      clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policy._key, refreshKey]);

  const run = runs.find((r) => r._key === selectedId) || runs[0];
  const active = run && ACTIVE.includes(run.status);
  const percent = run ? (run.status === "succeeded" ? 100 : Math.round(run.percent || 0)) : 0;

  return (
    <div className="card run-panel">
      <div className="run-panel-header">
        <div className="icon-badge" style={{ background: "#8b5cf626", color: "#8b5cf6", width: 52, height: 52, borderRadius: 12 }}>
          <WorkflowIcon width={26} height={26} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 className="run-panel-title">{policy.name}</h3>
          {run && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
              <RunStatus run={run} />
              <span className="muted" style={{ fontSize: "0.82rem" }}>
                Started {new Date(run.created_at).toLocaleString()}
                {run.wall_seconds != null && ` · took ${Math.round(run.wall_seconds)} s`}
              </span>
            </div>
          )}
        </div>
        <button className="close-btn" onClick={onClose} title="Close" aria-label="Close" style={{ position: "static" }}>
          <CloseIcon width={18} height={18} />
        </button>
      </div>
      {!run && <p className="muted">This policy hasn't been run yet — use Run in its action menu.</p>}
      {run && (
        <>
          <div className="progress-bar" style={{ marginTop: 14 }}>
            <div style={{ width: `${percent}%`, background: run.status === "failed" ? "#dc2626" : undefined }} />
          </div>
          <div className="run-panel-progress">
            <span className={run.status === "failed" ? "error-text" : "muted"}>
              {active && <strong className="run-panel-step">Step {run.step_index} of {run.steps_total}</strong>}
              {active && " · "}
              {run.message}
            </span>
            <strong>{percent}%</strong>
          </div>
          <div className="step-grid">
            {STEPS.map((s) => <StepCard key={s.key} step={s} data={run.steps?.[s.key]} run={run} />)}
          </div>
          <ForecastTable rows={run.steps?.forecast?.rows} />
        </>
      )}
      {run && showHistory && (
        <table className="compact" style={{ marginTop: 12 }}>
          <thead>
            <tr><th style={{ textAlign: "left" }}>Started</th><th style={{ textAlign: "left" }}>Status</th><th>Duration</th><th style={{ textAlign: "left" }}>Result</th></tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r._key} onClick={() => setSelectedId(r._key)} className={r._key === run?._key ? "selected" : ""} style={{ cursor: "pointer" }} title="Show this run">
                <td style={{ textAlign: "left" }}>{new Date(r.created_at).toLocaleString()}</td>
                <td style={{ textAlign: "left" }}><RunStatus run={r} /></td>
                <td>{r.wall_seconds != null ? `${Math.round(r.wall_seconds)} s` : "-"}</td>
                <td style={{ textAlign: "left" }}>{r.portfolio_id ? <Link to={`/portfolios/${r.portfolio_id}`} onClick={(e) => e.stopPropagation()}>Portfolio</Link> : r.error ? <span className="error-text">{r.error}</span> : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {run && (
        <div className="run-panel-footer">
          <button className="link-btn" onClick={() => setShowHistory((s) => !s)} aria-expanded={showHistory}>
            <ClockIcon width={15} height={15} />
            Run history ({runs.length})
            {showHistory ? <ChevronDownIcon width={14} height={14} /> : <ChevronRightIcon width={14} height={14} />}
          </button>
          {run.portfolio_id && (
            <Link to={`/portfolios/${run.portfolio_id}`} className="btn secondary btn-sm" style={{ textDecoration: "none" }}>
              View portfolio &rarr;
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
