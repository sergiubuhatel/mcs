import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";

import {
  importRequested,
  reset as resetImport,
  resumeRequested,
  stopRequested,
} from "../features/dataImport/dataImportSlice";
import { reset as resetAllocate } from "../features/rl/rlSlice";
import { CloseIcon, DatabaseIcon, DownloadIcon, StopIcon } from "./icons";

function pct(progress) {
  if (!progress || !progress.total) return 0;
  return Math.min(100, Math.round((progress.completed / progress.total) * 100));
}

function fmtDuration(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function fmtEta(seconds) {
  if (seconds == null || !isFinite(seconds) || seconds < 0) return "-";
  const minutes = seconds / 60;
  if (minutes < 1) return "<1 min";
  if (minutes < 60) return `~${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 24) return `~${hours.toFixed(1)} hr`;
  const days = hours / 24;
  return `~${days.toFixed(1)} d`;
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
          <span>
            {progress
              // Clamp: PPO's fixed-size training batches can overshoot the
              // requested total slightly, so raw `completed` can exceed `total`.
              ? `${Math.min(progress.completed ?? 0, progress.total ?? Infinity)}/${progress.total ?? "?"} (${pct(progress)}%)`
              : "starting..."}
          </span>
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

// Import gets a dedicated status widget (not the generic JobStatus above)
// because it alone supports Stop/Resume. All of its progress display and
// controls live here, in the bottom bar -- not duplicated in the popup panel.
function ImportStatus() {
  const dispatch = useDispatch();
  const importState = useSelector((s) => s.dataImport);
  const { status, progress, result, error, taskId, startedAt } = importState;
  const [, forceTick] = useState(0);

  const running = status === "starting" || status === "running" || status === "stopping";

  // Re-render once a second while running so the elapsed/ETA text stays live
  // without needing a new progress event for every tick.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  if (status === "idle") return null;

  const stopped = status === "stopped";
  const remaining = result?.remaining_tickers?.length ?? 0;
  const percent = pct(progress);
  const elapsedSeconds = startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0;
  const etaSeconds =
    progress?.completed ? (elapsedSeconds * (progress.total - progress.completed)) / progress.completed : null;

  return (
    <div
      className="flex flex-1 items-center gap-3 rounded-lg px-3 py-1.5"
      style={{ background: "var(--color-bg-secondary)", border: "1px solid var(--color-divider)", minWidth: 200 }}
    >
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
        style={{ background: "var(--btn-accent)", color: "#ffffff" }}
      >
        <DatabaseIcon />
      </div>

      {running && (
        <>
          <div className="shrink-0">
            <div className="text-xs font-semibold" style={{ color: "var(--color-text-primary)" }}>
              {status === "stopping" ? "Stopping import..." : "Importing stock data..."}
            </div>
            <div className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
              Current: {progress?.ticker ?? "-"}
            </div>
          </div>
          <span className="shrink-0 text-xs font-semibold" style={{ color: "var(--color-text-primary)" }}>
            {progress ? `${progress.completed}/${progress.total} (${percent}%)` : "starting..."}
          </span>
          <div className="progress-bar flex-1" style={{ margin: 0 }}>
            <div style={{ width: `${percent}%` }} />
          </div>
          <span className="shrink-0 text-xs" style={{ color: "var(--color-text-secondary)" }}>
            Elapsed {fmtDuration(elapsedSeconds)} · ETA {fmtEta(etaSeconds)}
          </span>
          <button
            className="btn danger shrink-0"
            onClick={() => dispatch(stopRequested(taskId))}
            disabled={status === "stopping"}
          >
            <StopIcon /> Stop
          </button>
        </>
      )}

      {status === "done" && (
        <span className="flex-1 text-xs" style={{ color: "#16a34a" }}>
          {result?.message ?? `Done — ${result?.succeeded_count ?? 0} imported, ${result?.failed_count ?? 0} failed`}
        </span>
      )}
      {stopped && (
        <span className="flex-1 text-xs" style={{ color: "#d97706" }}>
          Stopped — {result?.succeeded_count ?? 0} imported, {remaining} remaining
        </span>
      )}
      {status === "error" && <span className="flex-1 error-text">{error}</span>}

      {stopped && remaining > 0 && (
        <button className="btn shrink-0" onClick={() => dispatch(resumeRequested(taskId))}>
          <DownloadIcon /> Resume
        </button>
      )}
      {(status === "done" || stopped || status === "error") && (
        <button className="btn secondary shrink-0" style={{ padding: "3px 6px" }} onClick={() => dispatch(resetImport())} title="Dismiss">
          <CloseIcon />
        </button>
      )}
    </div>
  );
}

export default function BottomBar() {
  const dispatch = useDispatch();
  const [importPanelOpen, setImportPanelOpen] = useState(false);

  const importState = useSelector((s) => s.dataImport);
  const allocateState = useSelector((s) => s.rl);

  const importActive = ["starting", "running", "stopping"].includes(importState.status);

  return (
    <div className="relative shrink-0" style={{ borderTop: "1px solid var(--color-divider)", background: "var(--color-bg-primary)" }}>
      {importPanelOpen && (
        <div
          className="absolute bottom-full left-0 right-0 card"
          style={{ margin: 12, boxShadow: "0 -8px 24px rgba(0,0,0,0.15)" }}
        >
          <button className="close-btn" onClick={() => setImportPanelOpen(false)} title="Close" aria-label="Close">
            <CloseIcon />
          </button>
          <ImportPanel onClose={() => setImportPanelOpen(false)} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4 px-4 py-2">
        <button className="btn" onClick={() => setImportPanelOpen((v) => !v)} title="Import market data" disabled={importActive}>
          <DownloadIcon /> Import
        </button>

        <ImportStatus />

        <div className="flex flex-wrap items-center justify-end gap-4">
          <JobStatus label="Allocation" status={allocateState.status} progress={allocateState.progress} error={allocateState.error} onReset={() => dispatch(resetAllocate())} />
        </div>
      </div>
    </div>
  );
}

function ImportPanel({ onClose }) {
  const dispatch = useDispatch();
  const [scope, setScope] = useState("all"); // "all" | "specific"
  const [tickers, setTickers] = useState("");
  const [years, setYears] = useState(10);
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [importHistory, setImportHistory] = useState(true);
  const [importStatistics, setImportStatistics] = useState(true);

  const submit = () => {
    const list =
      scope === "specific" && tickers.trim()
        ? tickers.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean)
        : undefined; // undefined -> backend imports the full S&P 500 universe
    // "Only missing" only makes sense for the full-universe scope; typing
    // specific tickers is a deliberate refresh request and must overwrite
    // them even if they're already imported.
    dispatch(importRequested({
      tickers: list,
      years,
      only_missing: scope === "all" && onlyMissing,
      import_history: importHistory,
      import_statistics: importStatistics,
    }));
    onClose(); // progress/Stop/Resume live in the bottom bar, not here
  };

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
          <select value={years} onChange={(e) => setYears(Number(e.target.value))}>
            <option value={1}>1 year ago</option>
            <option value={2}>2 years ago</option>
            <option value={5}>5 years ago</option>
            <option value={10}>10 years ago</option>
            <option value={15}>15 years ago</option>
            <option value={20}>20 years ago</option>
          </select>
        </div>
      </div>
      <div style={{ display: "flex", gap: 16, margin: "8px 0" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem" }}>
          <input type="checkbox" checked={importHistory} onChange={(e) => setImportHistory(e.target.checked)} />
          Import history
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem" }}>
          <input type="checkbox" checked={importStatistics} onChange={(e) => setImportStatistics(e.target.checked)} />
          Import statistics
        </label>
      </div>
      {scope === "all" ? (
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem", margin: "8px 0" }}>
          <input
            type="checkbox"
            checked={onlyMissing}
            disabled={!importHistory}
            onChange={(e) => setOnlyMissing(e.target.checked)}
          />
          Only import what's missing (skip tickers that are already fully up to date)
        </label>
      ) : (
        <p className="muted" style={{ margin: "8px 0" }}>Specific tickers are always re-fetched and will overwrite any existing data for them.</p>
      )}
      <button
        className="btn"
        onClick={submit}
        disabled={(scope === "specific" && !tickers.trim()) || (!importHistory && !importStatistics)}
      >
        <DownloadIcon /> Start Import
      </button>
    </div>
  );
}
