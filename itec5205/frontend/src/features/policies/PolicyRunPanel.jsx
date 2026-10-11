import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../../api/client";
import { CloseIcon } from "../../layout/icons";

export const ACTIVE = ["queued", "running"];

const STATUS_COLORS = {
  succeeded: "#16a34a",
  failed: "#dc2626",
  cancelled: "var(--color-text-secondary)",
  running: "var(--color-text-accent)",
  queued: "var(--color-text-accent)",
};
const STATUS_LABELS = { succeeded: "Succeeded", failed: "Failed", cancelled: "Cancelled", running: "Running", queued: "Queued" };

export function RunStatus({ run }) {
  if (!run) return <span className="muted">Never run</span>;
  return (
    <span className="pill" style={{ color: STATUS_COLORS[run.status], background: "var(--color-bg-tertiary)" }}>
      {STATUS_LABELS[run.status] || run.status}
    </span>
  );
}

/** One-line progress for the grid: bar + "Step 2 of 3 · message". */
export function RunProgress({ run }) {
  if (!run || run.status === "cancelled") return <span className="muted">—</span>;
  const active = ACTIVE.includes(run.status);
  return (
    <div style={{ minWidth: 0 }}>
      {active && (
        <div className="progress-bar" style={{ margin: "2px 0" }}>
          <div style={{ width: `${run.percent || 0}%` }} />
        </div>
      )}
      <span
        className={run.status === "failed" ? "error-text" : "muted"}
        title={run.message}
        style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.78rem" }}
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
  { key: "data", title: "1. Data", waiting: "Import with the data criteria" },
  { key: "screen", title: "2. Screen", waiting: "Search by the screen criteria" },
  { key: "forecast", title: "3. Predict", waiting: "Forecast and filter by the prediction criteria" },
  { key: "portfolio", title: "4. Portfolio", waiting: "Build the portfolio with the portfolio criteria" },
];

function StepCard({ step, data, run }) {
  const status = data?.status || (ACTIVE.includes(run.status) ? "waiting" : "skipped");
  const color = { done: "#16a34a", failed: "#dc2626", running: "var(--color-text-accent)" }[status] || "var(--color-text-secondary)";
  const current = run.step === step.key && ACTIVE.includes(run.status);
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
    body = (
      <>
        {data.holdings} companies · return {fmtPct(data.metrics?.annual_return)} · volatility {fmtPct(data.metrics?.expected_volatility)}
      </>
    );
  } else if (current && step.key !== "data") body = run.message;
  return (
    <div className="filter-group" style={{ borderColor: current ? "var(--color-text-accent)" : undefined }}>
      <h4 style={{ color: "var(--color-text-primary)", justifyContent: "space-between" }}>
        {step.title}
        <span style={{ color, fontSize: "0.75rem", fontWeight: 500 }}>{status}</span>
      </h4>
      <div className="muted">{body}</div>
    </div>
  );
}

function ForecastTable({ rows }) {
  if (!rows?.length) return null;
  const models = Object.keys(rows[0].models);
  const points = Object.keys(Object.values(rows[0].models).find(Boolean)?.changes || {});
  return (
    <div style={{ maxHeight: 360, overflow: "auto", marginTop: 10 }}>
      <table>
        <thead>
          <tr>
            <th>Ticker</th>
            <th>Result</th>
            {models.flatMap((m) => points.map((p) => <th key={`${m}${p}`}>{m.toUpperCase()} {p}</th>))}
          </tr>
        </thead>
        <tbody>
          {[...rows]
            .sort((a, b) => Number(b.passed) - Number(a.passed) || a.ticker.localeCompare(b.ticker))
            .map((r) => (
              <tr key={r.ticker}>
                <td><Link to={`/companies/${r.ticker}`}>{r.ticker}</Link></td>
                <td style={{ color: r.passed ? "#16a34a" : "#dc2626" }} title={r.reason || ""}>{r.passed ? "passed" : r.reason}</td>
                {models.flatMap((m) =>
                  points.map((p) => {
                    const v = r.models[m]?.changes?.[p];
                    return (
                      <td key={`${m}${p}`} style={{ color: changeColor(v) }}>
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

  return (
    <div className="card" style={{ position: "relative" }}>
      <button className="close-btn" onClick={onClose} title="Close" aria-label="Close" style={{ position: "absolute", top: 12, right: 12 }}>
        <CloseIcon width={18} height={18} />
      </button>
      <h3>{policy.name}</h3>
      {!run && <p className="muted">This policy hasn't been run yet — use Run in its action menu.</p>}
      {run && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <RunStatus run={run} />
            <span className="muted">
              Started {new Date(run.created_at).toLocaleString()}
              {run.wall_seconds != null && ` · took ${Math.round(run.wall_seconds)} s`}
            </span>
            {run.portfolio_id && <Link to={`/portfolios/${run.portfolio_id}`}>View portfolio &rarr;</Link>}
          </div>
          <div className="progress-bar">
            <div style={{ width: `${run.status === "succeeded" ? 100 : run.percent || 0}%`, background: run.status === "failed" ? "#dc2626" : undefined }} />
          </div>
          <p className={run.status === "failed" ? "error-text" : "muted"} style={{ marginTop: 0 }}>
            {ACTIVE.includes(run.status) && `Step ${run.step_index} of ${run.steps_total} · `}
            {run.message}
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            {STEPS.map((s) => <StepCard key={s.key} step={s} data={run.steps?.[s.key]} run={run} />)}
          </div>
          <ForecastTable rows={run.steps?.forecast?.rows} />
        </>
      )}
      {runs.length > 1 && (
        <>
          <h4 style={{ marginBottom: 4 }}>Run history</h4>
          <table>
            <thead>
              <tr><th>Started</th><th>Status</th><th>Duration</th><th>Result</th></tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r._key} onClick={() => setSelectedId(r._key)} style={{ cursor: "pointer", background: r._key === run?._key ? "var(--color-bg-tertiary)" : undefined }}>
                  <td>{new Date(r.created_at).toLocaleString()}</td>
                  <td style={{ textAlign: "left" }}><RunStatus run={r} /></td>
                  <td>{r.wall_seconds != null ? `${Math.round(r.wall_seconds)} s` : "-"}</td>
                  <td>{r.portfolio_id ? <Link to={`/portfolios/${r.portfolio_id}`} onClick={(e) => e.stopPropagation()}>Portfolio</Link> : r.error ? <span className="error-text">{r.error}</span> : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
