import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../../api/client";
import { TrendChartIcon } from "../../layout/icons";
import { HORIZONS } from "../predictions/ForecastTables";

const SIGNAL_STYLE = {
  Strong: { background: "#16a34a", color: "#fff" },
  Mixed: { background: "#d97706", color: "#fff" },
  Weak: { background: "var(--color-divider)", color: "var(--color-text-primary)" },
  Avoid: { background: "#dc2626", color: "#fff" },
};

const STAR_LABELS = [
  ["fundamentals", "Fundamentals: still passes the pool's screen"],
  ["rl", "RL: held by the latest RL allocation"],
  ["lstm", "LSTM: up at all four horizons"],
  ["arima", "ARIMA: up at all four horizons"],
];

const SIGNAL_RANK = { Strong: 3, Mixed: 2, Weak: 1, Avoid: 0 };

// Sort key per column; "lstm:1M"-style keys read that model's horizon change.
function sortValue(row, key) {
  if (key === "signal") return SIGNAL_RANK[row.signal];
  if (key === "stars") {
    const vals = Object.values(row.stars || {});
    return vals.filter(Boolean).length - vals.filter((v) => v === null || v === undefined).length / 10;
  }
  if (key === "rl_weight") return row.rl_weight;
  const [model, label] = key.split(":");
  return row[model]?.horizons[label]?.change_pct;
}

function Stars({ stars }) {
  return (
    <span style={{ letterSpacing: 1, whiteSpace: "nowrap" }}>
      {STAR_LABELS.map(([key, label]) => {
        const v = stars[key];
        const glyph = v === null || v === undefined ? "·" : v ? "★" : "☆";
        const color = v ? "#eab308" : "var(--color-text-secondary)";
        return (
          <span key={key} title={`${label}: ${v === null || v === undefined ? "n/a" : v ? "yes" : "no"}`} style={{ color }}>
            {glyph}
          </span>
        );
      })}
    </span>
  );
}

// Colored by the direction the backend assigned (moves inside the ±deadband
// count as flat -> neutral), so the color always matches the stars/agreement.
function Pct({ point, title }) {
  if (!point || point.change_pct === null || point.change_pct === undefined) return <span className="muted">-</span>;
  const value = point.change_pct;
  const dir = point.direction;
  const color = dir === "up" ? "#16a34a" : dir === "down" ? "#dc2626" : "var(--color-text-primary)";
  const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "≈";
  const digits = Math.abs(value) < 1 ? 2 : 1;
  return (
    <span title={title} style={{ color, fontWeight: dir === "flat" ? 400 : 600, whiteSpace: "nowrap" }}>
      {arrow}{value > 0 ? "+" : ""}{value.toFixed(digits)}%
    </span>
  );
}

function AgreeCell({ value }) {
  if (!value) return <span className="muted">-</span>;
  if (value === "agree_up") return <span style={{ color: "#16a34a", fontWeight: 700 }} title="Both up">▲▲</span>;
  if (value === "agree_down") return <span style={{ color: "#dc2626", fontWeight: 700 }} title="Both down">▼▼</span>;
  return <span className="muted" title="LSTM and ARIMA disagree (or one is flat)">≠</span>;
}

export function SignalBadge({ signal }) {
  return (
    <span style={{ ...SIGNAL_STYLE[signal], borderRadius: 10, padding: "2px 10px", fontSize: "0.78rem", fontWeight: 700 }}>
      {signal}
    </span>
  );
}

export function progressText(run) {
  const { lstm, arima } = run.counts;
  return `LSTM ${lstm.done + lstm.failed}/${lstm.total} · ARIMA ${arima.done + arima.failed}/${arima.total}`;
}

/** Combined evidence for a pool (`poolId`) or a portfolio (`portfolioId`). */
export default function SignalBoard({ poolId, portfolioId, onRefined, refreshKey }) {
  const scope = poolId ? { pool_id: poolId } : { portfolio_id: portfolioId };
  const [board, setBoard] = useState(null);
  const [error, setError] = useState(null);
  const [run, setRun] = useState(null);
  const [trainingDays, setTrainingDays] = useState(756);
  const [epochs, setEpochs] = useState(100);
  const [refining, setRefining] = useState(false);
  const [refineRule, setRefineRule] = useState("keep_strong"); // "keep_strong" | "drop_weak"
  const [sortBy, setSortBy] = useState(null); // "signal" | "stars" | "rl_weight" | "lstm:1M" ...; null = backend order
  const [sortDir, setSortDir] = useState("desc");
  const pollRef = useRef(null);

  const loadBoard = useCallback(() => {
    apiClient
      .get("/api/signals", { params: scope })
      .then((res) => setBoard(res.data))
      .catch((err) => setError(err.response?.data?.error || err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolId, portfolioId]);

  const poll = useCallback(
    (runId) => {
      clearTimeout(pollRef.current);
      apiClient
        .get(`/api/forecasts/batch/${runId}`)
        .then((res) => {
          setRun(res.data);
          if (res.data.finished) loadBoard();
          else pollRef.current = setTimeout(() => poll(runId), 2000);
        })
        .catch((err) => setError(err.response?.data?.error || err.message));
    },
    [loadBoard]
  );

  useEffect(() => {
    setBoard(null);
    setRun(null);
    setError(null);
    loadBoard();
    // Resume a run that's still going (e.g. after navigating away and back).
    apiClient
      .get("/api/forecasts/batch", { params: scope })
      .then((res) => {
        if (res.data.run) {
          setRun(res.data.run);
          if (!res.data.run.finished) poll(res.data.run.run_id);
        }
      })
      .catch(() => {});
    return () => clearTimeout(pollRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolId, portfolioId]);

  useEffect(() => {
    if (refreshKey) loadBoard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const forecastAll = () => {
    setError(null);
    apiClient
      .post("/api/forecasts/batch", { ...scope, lookback_days: Number(trainingDays), epochs: Number(epochs) })
      .then((res) => {
        setRun(res.data);
        poll(res.data.run_id);
      })
      .catch((err) => setError(err.response?.data?.error || err.message));
  };

  const cancel = () => {
    clearTimeout(pollRef.current);
    apiClient
      .post(`/api/forecasts/batch/${run.run_id}/cancel`)
      .then((res) => {
        setRun(res.data);
        loadBoard();
      })
      .catch((err) => setError(err.response?.data?.error || err.message));
  };

  const refine = () => {
    setRefining(true);
    setError(null);
    apiClient
      .post(`/api/pools/${poolId}/refine`, { rule: refineRule })
      .then((res) => onRefined?.(res.data))
      .catch((err) => setError(err.response?.data?.error || err.message))
      .finally(() => setRefining(false));
  };

  const running = run && !run.finished;
  const done = run ? run.counts.lstm.done + run.counts.lstm.failed + run.counts.arima.done + run.counts.arima.failed : 0;
  const total = run ? run.counts.lstm.total + run.counts.arima.total : 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const s = board?.summary;

  const onSortClick = (key) => {
    if (key === sortBy) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortBy(key);
      setSortDir("desc");
    }
  };
  // Missing values always sink to the bottom, whichever direction.
  const rows = !board ? [] : !sortBy ? board.rows : board.rows.slice().sort((a, b) => {
    const va = sortValue(a, sortBy);
    const vb = sortValue(b, sortBy);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return sortDir === "desc" ? vb - va : va - vb;
  });
  const sortableTh = (key, label, title, props = {}) => (
    <th key={key} className={sortBy === key ? "sorted" : ""} onClick={() => onSortClick(key)} title={title} {...props}>
      {label}
      <span style={{ visibility: sortBy === key ? "visible" : "hidden" }}>{sortDir === "desc" ? "↓" : "↑"}</span>
    </th>
  );
  // Explicit textAlign: the global th:first-child/nth-child(2) rule would
  // otherwise left-align the first two cells of this second header row.
  const horizonHeader = (model) =>
    HORIZONS.map((h) =>
      sortableTh(`${model}:${h.label}`, h.label, `Sort by ${model.toUpperCase()} ${h.name} change`, { style: { textAlign: "right" } })
    );
  const droppable = !s ? 0 : refineRule === "drop_weak" ? s.Weak + s.Avoid : s.Mixed + s.Weak + s.Avoid;

  return (
    <div className="card">
      <h3>Signal board — do all the stars align?</h3>
      <p className="muted">
        Four pieces of evidence per company: <strong>fundamentals</strong> (still passes the pool's screen),{" "}
        <strong>RL</strong> (held by the latest RL allocation), <strong>LSTM</strong> and <strong>ARIMA</strong> (each
        forecasting up at 1, 2, 3 and 4 months). LSTM and ARIMA <em>agree</em> only when they call the same direction at
        all four horizons; a move within ±{board?.deadband_pct ?? 0.05}% counts as flat (≈). <strong>Strong</strong> = every
        available star is lit; <strong>Avoid</strong> = both models agree on down.
        {board && !board.has_screen && " This pool has no saved screen, so the fundamentals star is n/a."}
        {board && board.portfolio_id === null && " No RL portfolio has been trained on it yet, so the RL star is n/a."}
      </p>

      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <label style={{ display: "block", fontSize: "0.78rem", color: "var(--color-text-secondary)" }}>Training days</label>
          <input type="number" min={120} value={trainingDays} onChange={(e) => setTrainingDays(e.target.value)} style={{ width: 90 }} disabled={running} />
        </div>
        <div>
          <label style={{ display: "block", fontSize: "0.78rem", color: "var(--color-text-secondary)" }}>LSTM max epochs</label>
          <input type="number" min={1} value={epochs} onChange={(e) => setEpochs(e.target.value)} style={{ width: 90 }} disabled={running} />
        </div>
        <button className="btn" onClick={forecastAll} disabled={running}>
          <TrendChartIcon /> {running ? "Forecasting..." : `Forecast all (LSTM + ARIMA)`}
        </button>
        {running && (
          <button className="btn secondary" onClick={cancel} title="Stop this run's remaining jobs">
            Cancel
          </button>
        )}
        {poolId && (
          <>
            <select value={refineRule} onChange={(e) => setRefineRule(e.target.value)} disabled={running || refining} title="Refinement rule">
              <option value="keep_strong">Keep only Strong</option>
              <option value="drop_weak">Drop Weak &amp; Avoid</option>
            </select>
            <button
              className="btn secondary"
              onClick={refine}
              disabled={running || refining || droppable === 0}
              title="Refinement loop: a new pool without these companies (one iteration deeper); then retrain RL on it"
            >
              {refining ? "Refining..." : `Refine: drop ${droppable} → new pool`}
            </button>
          </>
        )}
      </div>

      {run && (
        <div style={{ marginTop: 8 }}>
          {running && <div className="progress-bar"><div style={{ width: `${pct}%` }} /></div>}
          <p className="muted" style={{ margin: "4px 0" }}>
            {run.queued && <strong>Waiting in queue behind other forecast runs · </strong>}
            {run.cancelled && <strong>Cancelled · </strong>}
            {progressText(run)}
            {run.finished && !run.cancelled && run.wall_seconds != null && ` · finished in ${run.wall_seconds.toFixed(1)} s`}
            {run.mean_train_seconds?.lstm != null && ` · avg LSTM ${run.mean_train_seconds.lstm.toFixed(1)} s`}
            {run.mean_train_seconds?.arima != null && ` · avg ARIMA ${run.mean_train_seconds.arima.toFixed(1)} s`}
            {` · trained on ${run.params.lookback_days} days`}
          </p>
          {run.errors?.length > 0 && (
            <p className="error-text">{run.errors.map((e) => `${e.ticker} (${e.model}): ${e.error}`).join("; ")}</p>
          )}
        </div>
      )}
      {error && <p className="error-text">{error}</p>}

      {s && (
        <p style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          {["Strong", "Mixed", "Weak", "Avoid"].map((k) => (
            <span key={k}><SignalBadge signal={k} /> {s[k]}</span>
          ))}
          <span className="muted">· models agree on {s.agree}, disagree on {s.disagree}</span>
          {s.missing_forecasts > 0 && <span className="muted">· {s.missing_forecasts} without both forecasts</span>}
        </p>
      )}

      {board && (
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th rowSpan={2} style={{ textAlign: "left" }}>Company</th>
                {sortableTh("signal", "Signal", "Sort by signal (Strong → Avoid)", { rowSpan: 2 })}
                {sortableTh("stars", "Stars", "Sort by number of lit stars", { rowSpan: 2 })}
                {sortableTh("rl_weight", "RL weight", "Sort by RL allocation weight", { rowSpan: 2 })}
                <th colSpan={4}>LSTM change</th>
                <th colSpan={4}>ARIMA change</th>
                <th colSpan={4}>Agree</th>
              </tr>
              <tr>
                {horizonHeader("lstm")}
                {horizonHeader("arima")}
                {HORIZONS.map((h) => <th key={`g-${h.label}`} style={{ textAlign: "right", cursor: "default" }}>{h.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.ticker}>
                  <td style={{ textAlign: "left" }}>
                    <Link to={`/companies/${r.ticker}`}><strong>{r.ticker}</strong></Link>{" "}
                    <span className="muted" style={{ fontSize: "0.8rem" }}>{r.name}</span>
                    {r.window_mismatch && (
                      <span className="error-text" title="LSTM and ARIMA were trained on different windows/data -- re-run Forecast all"> ⚠</span>
                    )}
                  </td>
                  <td><SignalBadge signal={r.signal} /></td>
                  <td><Stars stars={r.stars} /></td>
                  <td>{r.rl_weight === null || r.rl_weight === undefined ? <span className="muted">n/a</span> : `${(r.rl_weight * 100).toFixed(1)}%`}</td>
                  {HORIZONS.map((h) => <td key={`l-${h.label}`}><Pct point={r.lstm?.horizons[h.label]} /></td>)}
                  {HORIZONS.map((h) => {
                    const a = r.arima?.horizons[h.label];
                    return (
                      <td key={`a-${h.label}`}>
                        <Pct point={a} title={a?.prob_up != null ? `P(up) = ${(a.prob_up * 100).toFixed(0)}%` : undefined} />
                      </td>
                    );
                  })}
                  {HORIZONS.map((h) => <td key={`g-${h.label}`}><AgreeCell value={r.horizon_agreement?.[h.label]} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
