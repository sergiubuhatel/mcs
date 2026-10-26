import { useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";
import { apiClient } from "../api/client";
import Modal from "../components/Modal";
import { DownloadIcon, TrashIcon, UploadIcon } from "./icons";

const fmtInt = (n) => (n == null ? "–" : Number(n).toLocaleString());
const fmtWhen = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "–");

// Readable names for the collection counts shown before deleting.
const GROUPS = [
  ["Market data", ["companies", "sectors", "industries", "stock_prices", "stock_stats", "calculated_stats", "earnings_reports", "earnings_dates", "delisted_tickers"]],
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

function ImportAllModal({ isOpen, onClose }) {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState(null); // restore progress from the server
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const running = status?.status === "running";

  useEffect(() => {
    if (!isOpen) return;
    setFile(null);
    setError(null);
    apiClient.get("/api/backup/import/status").then((r) => setStatus(r.data.status === "running" ? r.data : null)).catch(() => {});
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !running) return undefined;
    const timer = setInterval(() => {
      apiClient.get("/api/backup/import/status").then((r) => setStatus(r.data)).catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [isOpen, running]);

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

  const pct = status?.total ? Math.floor((status.done / status.total) * 100) : 0;
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Import all data" maxWidth={560}>
      <div style={{ display: "grid", gap: 10, fontSize: "0.88rem" }}>
        <p style={{ margin: 0 }}>
          Loads a file made with <strong>Export All</strong>, e.g. on a new installation. Every document in the file is added;
          one with the same key replaces what is stored. For an exact copy of the exported data, use Delete All Data first.
        </p>
        {!status && (
          <>
            <input type="file" accept=".gz,.jsonl,.json,application/gzip" onChange={(e) => setFile(e.target.files?.[0] || null)} disabled={uploading} />
            {file && <span className="muted">{file.name} · {(file.size / 1e6).toFixed(1)} MB</span>}
            <div>
              <button className="btn" onClick={start} disabled={!file || uploading}>
                <UploadIcon /> {uploading ? "Uploading…" : "Import"}
              </button>
            </div>
          </>
        )}
        {status && (
          <div>
            <div><strong>{running ? "Importing…" : status.status === "done" ? "Import finished" : "Import failed"}</strong></div>
            <div className="muted">
              Export of {fmtWhen(status.exported_at)} · {fmtInt(status.done)} of {fmtInt(status.total)} documents ({pct}%)
              {status.collection ? ` · ${status.collection}` : ""}
            </div>
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
export default function BottomBar() {
  const [dialog, setDialog] = useState(null); // "import" | "delete" | null
  const link = useRef(null);

  const exportAll = () => {
    link.current.click(); // the browser streams the download itself
    toast.info("Export started: the browser downloads one compressed file (a few minutes for the full database).");
  };

  return (
    <div className="bottom-bar">
      <button className="btn secondary" onClick={() => setDialog("import")} title="Load a file made with Export All">
        <UploadIcon /> Import All
      </button>
      <button className="btn secondary" onClick={exportAll} title="Download every collection as one .jsonl.gz file">
        <DownloadIcon /> Export All
      </button>
      <a ref={link} href="/api/backup/export" download hidden aria-hidden="true" />
      <button className="btn danger" onClick={() => setDialog("delete")} title="Empty the whole database">
        <TrashIcon /> Delete All Data
      </button>
      <ImportAllModal isOpen={dialog === "import"} onClose={() => setDialog(null)} />
      <DeleteAllModal isOpen={dialog === "delete"} onClose={() => setDialog(null)} />
    </div>
  );
}
