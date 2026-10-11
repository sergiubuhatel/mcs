import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";

import { importRequested, reset as resetImport, resumeRequested, stopRequested } from "./dataImportSlice";
import Req from "../../components/Req";
import { CloseIcon, DatabaseIcon, DownloadIcon, StopIcon } from "../../layout/icons";

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

// Import gets a dedicated status widget (not the bottom bar's generic
// JobStatus) because it alone supports Stop/Resume. Shown on the Data page
// and in the bottom bar, so a running import stays visible on every page.
export function ImportStatus() {
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

// Import options: `tickers` is the comma-separated text as typed.
export const DEFAULT_IMPORT_OPTIONS = {
  scope: "all", // "all" | "specific"
  tickers: "",
  years: 10,
  only_missing: true,
  import_history: true,
  import_statistics: true,
  import_calculated_stats: true,
};

export const parseTickers = (text) =>
  (text || "").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);

export const importOptionsInvalid = (v) =>
  (v.scope === "specific" && parseTickers(v.tickers).length === 0) ||
  (!v.import_history && !v.import_statistics && !v.import_calculated_stats);

const checkLabel = { display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem" };

// Checkbox with a one-line description under its label.
function OptionCheck({ checked, onChange, disabled, label, help }) {
  return (
    <label className="option-check" style={{ opacity: disabled ? 0.55 : 1 }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="option-check-label">{label}</span>
        <span className="option-check-help">{help}</span>
      </span>
    </label>
  );
}

/** The import option fields, shared by the Market Data page and Data Criteria. */
export function ImportOptionsFields({ value, onChange, name = "import-scope" }) {
  const set = (patch) => onChange({ ...value, ...patch });
  return (
    <div className="import-fields">
      <div className="import-fields-title">Select companies</div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", margin: "4px 0 10px" }}>
        <label style={checkLabel}>
          <input type="radio" name={name} checked={value.scope === "all"} onChange={() => set({ scope: "all" })} />
          All S&amp;P 500 companies (~503 tickers)
        </label>
        <label style={checkLabel}>
          <input type="radio" name={name} checked={value.scope === "specific"} onChange={() => set({ scope: "specific" })} />
          Specific tickers
        </label>
      </div>
      <div className="filters-grid">
        <div>
          <label>Tickers (comma-separated){value.scope === "specific" && <Req />}</label>
          <input
            value={value.tickers}
            onChange={(e) => set({ tickers: e.target.value })}
            placeholder="e.g. AAPL, MSFT"
            disabled={value.scope !== "specific"}
          />
        </div>
        <div>
          <label>Since<Req /></label>
          <select value={value.years} onChange={(e) => set({ years: Number(e.target.value) })}>
            {[1, 2, 5, 10, 15, 20].map((y) => (
              <option key={y} value={y}>{y} year{y === 1 ? "" : "s"} ago</option>
            ))}
          </select>
        </div>
      </div>
      <div className="import-fields-title" style={{ borderTop: "1px solid var(--color-divider)", paddingTop: 12 }}>Import options</div>
      <div className="option-grid">
        <OptionCheck
          checked={value.import_history}
          onChange={(v) => set({ import_history: v })}
          label="Import history"
          help="Daily closing prices since the chosen year"
        />
        <OptionCheck
          checked={value.import_statistics}
          onChange={(v) => set({ import_statistics: v })}
          label="Import statistics"
          help="Price, market cap, valuation ratios, margins"
        />
        <OptionCheck
          checked={value.import_calculated_stats}
          onChange={(v) => set({ import_calculated_stats: v })}
          label="Import calculated statistics"
          help="1-year change and volatility from the prices"
        />
      </div>
      {value.scope === "all" ? (
        <OptionCheck
          checked={value.only_missing}
          disabled={!value.import_history}
          onChange={(v) => set({ only_missing: v })}
          label="Only import what's missing"
          help="Skip tickers already up to date with the last trading day"
        />
      ) : (
        <p className="muted" style={{ margin: "8px 0" }}>Specific tickers are always re-fetched and will overwrite any existing data for them.</p>
      )}
      {importOptionsInvalid(value) && (
        <p className="error-text" style={{ margin: "4px 0" }}>
          {value.scope === "specific" && parseTickers(value.tickers).length === 0 ? "List the tickers to import." : "Pick at least one thing to import."}
        </p>
      )}
    </div>
  );
}

/** The import form (Market Data page). Progress, Stop and Resume are in ImportStatus. */
export function ImportPanel() {
  const dispatch = useDispatch();
  const importActive = useSelector((s) => ["starting", "running", "stopping"].includes(s.dataImport.status));
  const [options, setOptions] = useState(DEFAULT_IMPORT_OPTIONS);

  const submit = () => {
    // "Only missing" only makes sense for the full-universe scope; typing
    // specific tickers is a deliberate refresh request and must overwrite
    // them even if they're already imported.
    dispatch(importRequested({
      tickers: options.scope === "specific" ? parseTickers(options.tickers) : undefined, // undefined -> full S&P 500
      years: options.years,
      only_missing: options.scope === "all" && options.only_missing,
      import_history: options.import_history,
      import_statistics: options.import_statistics,
      import_calculated_stats: options.import_calculated_stats,
    }));
  };

  return (
    <div>
      <ImportOptionsFields value={options} onChange={setOptions} />
      <button className="btn btn-lg" style={{ marginTop: 14 }} onClick={submit} disabled={importActive || importOptionsInvalid(options)}>
        <DownloadIcon width={18} height={18} /> {importActive ? "Importing..." : "Start Import"}
      </button>
    </div>
  );
}
