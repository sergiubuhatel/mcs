import { useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";
import { apiClient } from "../api/client";
import Modal from "../components/Modal";
import { isAdminUser, useAuth } from "../auth/Authorization";
import { DownloadIcon, TrashIcon, UploadIcon } from "./icons";

const fmtInt = (n) => (n == null ? "–" : Number(n).toLocaleString());

// Readable names for the collection counts shown before deleting.
const GROUPS = [
  ["Market data", ["companies", "sectors", "industries", "stock_prices", "stock_stats", "calculated_stats", "earnings_reports", "earnings_dates", "financial_statements", "delisted_tickers"]],
  ["Forecasts", ["price_predictions", "arima_predictions", "forecast_runs"]],
  ["Pools and portfolios", ["pools", "portfolios", "rl_runs"]],
  ["Criteria and workflows", ["criteria", "workflows", "workflow_runs"]],
  ["History and settings", ["import_runs", "settings", "order_plans"]],
];

function groupCounts(counts) {
  const named = new Set(GROUPS.flatMap(([, names]) => names));
  const rows = GROUPS.map(([label, names]) => [label, names.reduce((n, c) => n + (counts[c] || 0), 0)]);
  const other = Object.entries(counts).filter(([c]) => !named.has(c)).reduce((n, [, v]) => n + v, 0);
  return other ? [...rows, ["Other", other]] : rows;
}

function ImportAllModal({ file, onClose }) {
  const [status, setStatus] = useState(null); // restore progress from the server
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const running = status?.status === "running";

  useEffect(() => {
    setStatus(null);
    setError(null);
  }, [file]);

  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => {
      apiClient.get("/api/backup/import/status").then((r) => setStatus(r.data)).catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [running]);

  const start = async () => {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      await apiClient.post("/api/backup/import", form, { timeout: 0 });
      const r = await apiClient.get("/api/backup/import/status");
      setStatus(r.data);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal isOpen={!!file} onClose={running ? () => {} : onClose} title="Import all data" maxWidth={560}>
      <div style={{ display: "grid", gap: 10, fontSize: "0.88rem" }}>
        <div><strong>{file?.name}</strong> <span className="muted">· {((file?.size || 0) / 1e6).toFixed(1)} MB</span></div>
        {!status && (
          <>
            <div className="danger-box" role="alert">
              <UploadIcon style={{ color: "#dc2626", flexShrink: 0, marginTop: 2 }} />
              <div>
                <strong style={{ color: "#dc2626" }}>The data in this file replaces the current data.</strong> Every collection in
                the file (an ArangoDB dump made with Export All) is recreated exactly as it was exported.
              </div>
            </div>
            <div>
              <button className="btn" onClick={start} disabled={uploading}>
                <UploadIcon /> {uploading ? "Uploading…" : "Import"}
              </button>
            </div>
          </>
        )}
        {status && (
          <div>
            <strong>{running ? "Importing… (several minutes for the full database)" : status.status === "done" ? "Import finished" : "Import failed"}</strong>
            {status.counts && (
              <div className="muted">{fmtInt(Object.values(status.counts).reduce((a, b) => a + b, 0))} documents in the database now.</div>
            )}
            {status.error && <p className="error-text" style={{ margin: "6px 0 0" }}>{status.error}</p>}
            {status.status === "done" && (
              <button className="btn" style={{ marginTop: 10 }} onClick={() => window.location.reload()}>Reload the app</button>
            )}
          </div>
        )}
        {error && <p className="error-text" style={{ margin: 0 }}>{error}</p>}
      </div>
    </Modal>
  );
}

function DeleteAllModal({ isOpen, onClose }) {
  const [counts, setCounts] = useState(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setTyped("");
    setError(null);
    setCounts(null);
    apiClient.get("/api/backup/summary").then((r) => setCounts(r.data)).catch((e) => setError(e.message));
  }, [isOpen]);

  const remove = async () => {
    setDeleting(true);
    setError(null);
    try {
      await apiClient.delete("/api/backup/all", { data: { confirm: typed } });
      window.location.reload();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
      setDeleting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Delete all data" maxWidth={560}>
      <div style={{ display: "grid", gap: 10, fontSize: "0.88rem" }}>
        <div className="danger-box" role="alert">
          <TrashIcon style={{ color: "#dc2626", flexShrink: 0, marginTop: 2 }} />
          <div>
            <strong style={{ color: "#dc2626" }}>Warning: this cannot be undone.</strong> Everything in the database is deleted:
            market data, forecasts, pools, portfolios, criteria, workflows, import history, Settings and the Order Calculator plan.
            Use <strong>Export All</strong> first to keep a copy.
          </div>
        </div>
        {counts && (
          <table>
            <tbody>
              {groupCounts(counts.counts).map(([label, n]) => (
                <tr key={label}>
                  <td style={{ textAlign: "left" }}>{label}</td>
                  <td>{fmtInt(n)}</td>
                </tr>
              ))}
              <tr>
                <td style={{ textAlign: "left", fontWeight: 600 }}>Total documents</td>
                <td style={{ fontWeight: 600 }}>{fmtInt(counts.total)}</td>
              </tr>
            </tbody>
          </table>
        )}
        <div>
          <label>Type DELETE to confirm</label>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="DELETE" autoComplete="off" />
        </div>
        <div>
          <button className="btn btn-danger-solid" onClick={remove} disabled={typed !== "DELETE" || deleting}>
            <TrashIcon /> {deleting ? "Deleting…" : "Delete all data"}
          </button>
        </div>
        {error && <p className="error-text" style={{ margin: 0 }}>{error}</p>}
      </div>
    </Modal>
  );
}

// Whole-database actions. Job progress (imports, training) stays on its own
// page; this bar holds only these buttons and is never covered.
// Export All: the browser asks where to save (Chrome / Edge); others save
// to their download folder, or ask if the browser is set to.
async function exportAll() {
  const name = `itec5205-arangodb-${new Date().toISOString().slice(0, 10)}.tar`;
  let handle = null;
  if (window.showSaveFilePicker) {
    try {
      handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: "ArangoDB dump", accept: { "application/x-tar": [".tar"] } }] });
    } catch (e) {
      if (e.name === "AbortError") return; // closed the dialog
      throw e;
    }
  }
  const id = toast.info("Exporting the database… (a few minutes)", { autoClose: false });
  try {
    const response = await fetch("/api/backup/export");
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `HTTP ${response.status}`);
    if (handle) {
      await response.body.pipeTo(await handle.createWritable());
    } else {
      const url = URL.createObjectURL(await response.blob());
      Object.assign(document.createElement("a"), { href: url, download: name }).click();
      URL.revokeObjectURL(url);
    }
    toast.update(id, { render: `Exported to ${handle ? handle.name : name}`, type: "success", autoClose: 5000 });
  } catch (e) {
    toast.update(id, { render: `Export failed: ${e.message}`, type: "error", autoClose: 8000 });
  }
}

// Whole-database actions. Job progress (imports, training) stays on its own
// page; this bar holds only these buttons and is never covered.
// The buttons are for admins and installers only; others see an empty bar.
export default function BottomBar() {
  const { keycloak } = useAuth();
  const [importFile, setImportFile] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const picker = useRef(null);

  if (!isAdminUser(keycloak)) return <div className="bottom-bar" />;

  return (
    <div className="bottom-bar">
      <button className="btn secondary" onClick={() => picker.current.click()} title="Choose a file made with Export All">
        <UploadIcon /> Import All
      </button>
      <input
        ref={picker}
        type="file"
        accept=".tar,application/x-tar"
        hidden
        onChange={(e) => {
          setImportFile(e.target.files?.[0] || null);
          e.target.value = ""; // the same file can be chosen again
        }}
      />
      <button className="btn secondary" onClick={exportAll} title="Save the whole database (ArangoDB dump) to a file">
        <DownloadIcon /> Export All
      </button>
      <button className="btn danger" onClick={() => setDeleting(true)} title="Empty the whole database">
        <TrashIcon /> Delete All Data
      </button>
      <ImportAllModal file={importFile} onClose={() => setImportFile(null)} />
      <DeleteAllModal isOpen={deleting} onClose={() => setDeleting(false)} />
    </div>
  );
}
