import { useDispatch, useSelector } from "react-redux";

import { ImportStatus } from "../features/dataImport/ImportControls";
import { reset as resetAllocate } from "../features/rl/rlSlice";
import { CloseIcon } from "./icons";

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

// The import itself is started from the Data page; the bar keeps its status
// (with Stop/Resume) visible on every page while it runs.
export default function BottomBar() {
  const dispatch = useDispatch();
  const importStatus = useSelector((s) => s.dataImport.status);
  const allocateState = useSelector((s) => s.rl);

  if (importStatus === "idle" && allocateState.status === "idle") return null;

  return (
    <div className="relative shrink-0" style={{ borderTop: "1px solid var(--color-divider)", background: "var(--color-bg-primary)" }}>
      <div className="flex flex-wrap items-center gap-4 px-4 py-2">
        <ImportStatus />

        <div className="flex flex-wrap items-center justify-end gap-4">
          <JobStatus label="Allocation" status={allocateState.status} progress={allocateState.progress} error={allocateState.error} onReset={() => dispatch(resetAllocate())} />
        </div>
      </div>
    </div>
  );
}
