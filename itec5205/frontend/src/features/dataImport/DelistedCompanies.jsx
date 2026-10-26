import { useEffect, useState } from "react";
import { apiClient } from "../../api/client";
import ActionMenu from "../../components/ActionMenu";
import Modal from "../../components/Modal";
import Req from "../../components/Req";
import { PlusIcon, SaveIcon, TrashIcon, XCircleIcon } from "../../layout/icons";

// Fired after the list changes anywhere (this card, a failed-ticker row).
export const DELISTED_CHANGED = "delisted-changed";

const SOURCE = { import: "Found by an import", manual: "Added by you" };
const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "–");

const WHAT_IT_DOES =
  "Its prices, statistics, forecasts and financial results are removed, it is taken out of stock pools, " +
  "and every whole-list import skips it. Portfolios keep it as built.";

/** Add tickers to the delisted list (removes their data). */
export async function markDelisted(tickers, reason) {
  const { data } = await apiClient.post("/api/data/delisted", { tickers, reason });
  window.dispatchEvent(new Event(DELISTED_CHANGED));
  return data;
}

function AddDelistedModal({ isOpen, onClose }) {
  const [tickers, setTickers] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const list = [...new Set(tickers.split(/[\s,]+/).map((t) => t.trim().toUpperCase()).filter(Boolean))];

  useEffect(() => {
    if (isOpen) {
      setTickers("");
      setReason("");
      setError(null);
    }
  }, [isOpen]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await markDelisted(list, reason);
      onClose();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Mark as delisted"
      maxWidth={560}
      headerActions={
        <button className="btn" onClick={save} disabled={saving || list.length === 0} title="Mark as delisted">
          <SaveIcon /> Save
        </button>
      }
    >
      <div style={{ display: "grid", gap: 10 }}>
        <div>
          <label>Tickers (comma-separated)<Req /></label>
          <input value={tickers} onChange={(e) => setTickers(e.target.value)} placeholder="e.g. AKE, GTXI" autoFocus />
        </div>
        <div>
          <label>Reason</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Marked delisted by the user" />
        </div>
        <p className="muted" style={{ margin: 0, fontSize: "0.82rem" }}>{WHAT_IT_DOES}</p>
        {error && <p className="error-text" style={{ margin: 0 }}>{error}</p>}
      </div>
    </Modal>
  );
}

/** Market Data page: companies removed as delisted and skipped by imports. */
export default function DelistedCompanies({ refreshKey }) {
  const [rows, setRows] = useState(null);
  const [adding, setAdding] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    apiClient.get("/api/data/delisted").then((r) => setRows(r.data.delisted)).catch(() => setRows([]));
  }, [refreshKey, reload]);

  useEffect(() => {
    const again = () => setReload((n) => n + 1);
    window.addEventListener(DELISTED_CHANGED, again);
    return () => window.removeEventListener(DELISTED_CHANGED, again);
  }, []);

  const restore = async (ticker) => {
    try {
      await apiClient.delete(`/api/data/delisted/${ticker}`);
    } catch (e) {
      window.alert(e.response?.data?.error || e.message);
    }
    setReload((n) => n + 1);
  };

  return (
    <div className="card" style={{ minWidth: 0 }}>
      <div className="card-header">
        <div className="icon-badge" style={{ background: "#dc262622", color: "#dc2626" }}>
          <XCircleIcon width={18} height={18} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 style={{ margin: 0 }}>Delisted companies{rows?.length ? ` (${rows.length})` : ""}</h3>
          <p className="muted" style={{ margin: 0 }}>Removed from the database and skipped by every whole-list import</p>
        </div>
        <button className="btn" onClick={() => setAdding(true)} title="Remove companies and skip them in every whole-list import">
          <PlusIcon width={15} height={15} /> Mark delisted
        </button>
      </div>
      {rows === null ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">None. Imports add a company here when Yahoo has no quote and no prices for the past month.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: "left", width: 90 }}>Ticker</th>
                <th style={{ textAlign: "left" }}>Company</th>
                <th style={{ textAlign: "left" }}>Why</th>
                <th style={{ textAlign: "left" }}>Added</th>
                <th style={{ textAlign: "center", width: 70 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.ticker}>
                  <td style={{ textAlign: "left", fontWeight: 600 }}>{d.ticker}</td>
                  <td style={{ textAlign: "left" }}>{d.name || "–"}</td>
                  <td style={{ textAlign: "left" }} title={d.reason}>{SOURCE[d.source] || d.source}</td>
                  <td style={{ textAlign: "left" }}>{fmtDay(d.detected_at)}</td>
                  <td style={{ textAlign: "center" }}>
                    <ActionMenu
                      extraItems={[{ label: "Remove from list (import again)", icon: TrashIcon, onClick: () => restore(d.ticker) }]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AddDelistedModal isOpen={adding} onClose={() => setAdding(false)} />
    </div>
  );
}
