import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";

import { importRequested, reset as resetImport } from "../features/dataImport/dataImportSlice";
import { trainRequested as predictRequested, reset as resetPredict } from "../features/predictions/predictionsSlice";
import { trainRequested as allocateRequested, reset as resetAllocate } from "../features/rl/rlSlice";
import { fetchRequested as fetchPoolsRequested } from "../features/pools/poolsSlice";
import { CloseIcon, DownloadIcon, PieChartIcon, TrendChartIcon } from "./icons";

function pct(progress) {
  if (!progress || !progress.total) return 0;
  return Math.min(100, Math.round((progress.completed / progress.total) * 100));
}

function JobStatus({ label, status, progress, error, onReset }) {
  if (status === "idle") return null;
  const running = status === "starting" || status === "running" || status === "training";
  return (
    <div className="flex items-center gap-2 text-xs" style={{ color: "var(--color-text-secondary)" }}>
      <span className="font-medium" style={{ color: "var(--color-text-primary)" }}>{label}:</span>
      {running && (
        <>
          <div className="progress-bar" style={{ width: 90, margin: 0 }}>
            <div style={{ width: `${pct(progress)}%` }} />
          </div>
          <span>{progress ? `${progress.completed ?? 0}/${progress.total ?? "?"}` : "starting..."}</span>
        </>
      )}
      {status === "done" && <span style={{ color: "#16a34a" }}>done</span>}
      {status === "error" && <span className="error-text">{error}</span>}
      {(status === "done" || status === "error") && (
        <button className="btn secondary" style={{ padding: "3px 6px" }} onClick={onReset} title="Dismiss">
          <CloseIcon />
        </button>
      )}
    </div>
  );
}

export default function BottomBar() {
  const dispatch = useDispatch();
  const [openPanel, setOpenPanel] = useState(null); // null | "import" | "predict" | "allocate"

  const importState = useSelector((s) => s.dataImport);
  const predictState = useSelector((s) => s.predictions);
  const allocateState = useSelector((s) => s.rl);
  const pools = useSelector((s) => s.pools.items);

  useEffect(() => {
    if (openPanel === "allocate") dispatch(fetchPoolsRequested());
  }, [openPanel, dispatch]);

  const togglePanel = (name) => setOpenPanel((cur) => (cur === name ? null : name));

  return (
    <div className="relative shrink-0" style={{ borderTop: "1px solid var(--color-divider)", background: "var(--color-bg-primary)" }}>
      {openPanel && (
        <div
          className="absolute bottom-full left-0 right-0 card"
          style={{ margin: 12, boxShadow: "0 -8px 24px rgba(0,0,0,0.15)" }}
        >
          {openPanel === "import" && <ImportPanel onClose={() => setOpenPanel(null)} />}
          {openPanel === "predict" && <PredictPanel onClose={() => setOpenPanel(null)} />}
          {openPanel === "allocate" && <AllocatePanel pools={pools} onClose={() => setOpenPanel(null)} />}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4 px-4 py-2">
        <button className="btn" onClick={() => togglePanel("import")} title="Import market data">
          <DownloadIcon /> Import
        </button>
        <button className="btn" onClick={() => togglePanel("predict")} title="Predict stock price">
          <TrendChartIcon /> Predict
        </button>
        <button className="btn" onClick={() => togglePanel("allocate")} title="Find asset allocation">
          <PieChartIcon /> Portfolio
        </button>

        <div className="flex flex-1 flex-wrap justify-end gap-4">
          <JobStatus label="Import" status={importState.status} progress={importState.progress} error={importState.error} onReset={() => dispatch(resetImport())} />
          <JobStatus label="Prediction" status={predictState.status} progress={predictState.progress} error={predictState.error} onReset={() => dispatch(resetPredict())} />
          <JobStatus label="Allocation" status={allocateState.status} progress={allocateState.progress} error={allocateState.error} onReset={() => dispatch(resetAllocate())} />
        </div>
      </div>
    </div>
  );
}

function ImportPanel({ onClose }) {
  const dispatch = useDispatch();
  const importState = useSelector((s) => s.dataImport);
  const [scope, setScope] = useState("all"); // "all" | "specific"
  const [tickers, setTickers] = useState("");
  const [period, setPeriod] = useState("2y");
  const [onlyMissing, setOnlyMissing] = useState(true);

  const running = importState.status === "starting" || importState.status === "running";
  const finished = importState.status === "done" || importState.status === "error";

  const submit = () => {
    const list =
      scope === "specific" && tickers.trim()
        ? tickers.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean)
        : undefined; // undefined -> backend imports the full S&P 500 universe
    dispatch(importRequested({ tickers: list, period, only_missing: onlyMissing }));
  };

  const closeAndReset = () => {
    dispatch(resetImport());
    onClose();
  };

  if (running || finished) {
    const p = importState.progress;
    const percent = p && p.total ? Math.min(100, Math.round((p.completed / p.total) * 100)) : 0;
    return (
      <div>
        <h3>Import market data</h3>
        {running && (
          <>
            <div className="progress-bar"><div style={{ width: `${percent}%` }} /></div>
            <p className="muted">
              {p ? `${p.ticker ? `Fetching ${p.ticker} — ` : ""}${p.completed}/${p.total} (${p.succeeded} ok, ${p.failed} failed)` : "Starting..."}
            </p>
          </>
        )}
        {importState.status === "done" && (
          <p className="muted">
            {importState.result?.message
              ? importState.result.message
              : `Done — ${importState.result?.succeeded_count ?? 0} imported, ${importState.result?.failed_count ?? 0} failed (of ${importState.result?.total ?? 0}).`}
          </p>
        )}
        {importState.status === "error" && <p className="error-text">{importState.error}</p>}
        {finished && <button className="btn secondary" onClick={closeAndReset}>Close</button>}
      </div>
    );
  }

  return (
    <div>
      <h3>Import market data</h3>
      <p className="muted">Choose what to import and since when price history should start.</p>
      <div style={{ display: "flex", gap: 16, margin: "8px 0" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem" }}>
          <input type="radio" name="import-scope" checked={scope === "all"} onChange={() => setScope("all")} />
          All S&amp;P 500 companies (~503 tickers)
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem" }}>
          <input type="radio" name="import-scope" checked={scope === "specific"} onChange={() => setScope("specific")} />
          Specific tickers
        </label>
      </div>
      <div className="filters-grid">
        <div>
          <label>Tickers (comma-separated)</label>
          <input
            value={tickers}
            onChange={(e) => setTickers(e.target.value)}
            placeholder="e.g. AAPL, MSFT"
            disabled={scope !== "specific"}
          />
        </div>
        <div>
          <label>Since</label>
          <select value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="1y">1 year ago</option>
            <option value="2y">2 years ago</option>
            <option value="5y">5 years ago</option>
            <option value="10y">10 years ago</option>
          </select>
        </div>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem", margin: "8px 0" }}>
        <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
        Only update what hasn't been imported yet (skip tickers already in the database)
      </label>
      <button className="btn" onClick={submit} disabled={scope === "specific" && !tickers.trim()}>
        <DownloadIcon /> Start Import
      </button>{" "}
      <button className="btn secondary" onClick={onClose}>Cancel</button>
    </div>
  );
}

function PredictPanel({ onClose }) {
  const dispatch = useDispatch();
  const [ticker, setTicker] = useState("");
  const [epochs, setEpochs] = useState(30);

  const submit = () => {
    if (!ticker.trim()) return;
    dispatch(predictRequested({ ticker: ticker.trim().toUpperCase(), epochs: Number(epochs) }));
    onClose();
  };

  return (
    <div>
      <h3>Predict stock price</h3>
      <p className="muted">Trains a per-ticker LSTM and forecasts the next 7 trading days.</p>
      <div className="filters-grid">
        <div>
          <label>Ticker</label>
          <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="e.g. AAPL" />
        </div>
        <div>
          <label>Epochs</label>
          <input type="number" value={epochs} onChange={(e) => setEpochs(e.target.value)} />
        </div>
      </div>
      <button className="btn" onClick={submit}><TrendChartIcon /> Predict</button>{" "}
      <button className="btn secondary" onClick={onClose}>Cancel</button>
    </div>
  );
}

function AllocatePanel({ pools, onClose }) {
  const dispatch = useDispatch();
  const [poolId, setPoolId] = useState("");
  const [riskAversion, setRiskAversion] = useState(1.0);
  const [timesteps, setTimesteps] = useState(20000);

  const submit = () => {
    if (!poolId) return;
    dispatch(allocateRequested({ pool_id: poolId, risk_aversion: Number(riskAversion), timesteps: Number(timesteps) }));
    onClose();
  };

  return (
    <div>
      <h3>Find asset allocation</h3>
      <p className="muted">Trains a PPO reinforcement-learning agent over a saved pool to recommend a low-risk/high-return allocation.</p>
      {pools.length === 0 ? (
        <p className="muted">No pools yet — go to Analytics, select some tickers, and save a pool first.</p>
      ) : (
        <div className="filters-grid">
          <div>
            <label>Pool</label>
            <select value={poolId} onChange={(e) => setPoolId(e.target.value)}>
              <option value="">Select a pool...</option>
              {pools.map((p) => (
                <option key={p._key} value={p._key}>{p.name} ({p.tickers.length} tickers)</option>
              ))}
            </select>
          </div>
          <div>
            <label>Risk aversion</label>
            <input type="number" step="0.1" value={riskAversion} onChange={(e) => setRiskAversion(e.target.value)} />
          </div>
          <div>
            <label>Training timesteps</label>
            <input type="number" step="1000" value={timesteps} onChange={(e) => setTimesteps(e.target.value)} />
          </div>
        </div>
      )}
      <button className="btn" onClick={submit} disabled={pools.length === 0}><PieChartIcon /> Optimize</button>{" "}
      <button className="btn secondary" onClick={onClose}>Cancel</button>
    </div>
  );
}
