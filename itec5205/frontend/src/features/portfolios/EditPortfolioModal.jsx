import { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { apiClient } from "../../api/client";
import Modal from "../../components/Modal";
import Req from "../../components/Req";
import TickerPicker, { loadCompanies } from "../../components/TickerPicker";
import { SaveIcon, TrashIcon } from "../../layout/icons";

const newId = () => Math.random().toString(36).slice(2, 10);
const toRows = (holdings) =>
  holdings.map((h) => ({ id: newId(), ticker: h.ticker, original: h.ticker, weight: (h.weight * 100).toFixed(2) }));

/** Edit a (not combined) portfolio: its name and notes, and its holdings --
 * remove a company, add new ones, change a ticker (e.g. a wrong one from an
 * import) and change the weights. Weights are typed as percentages and
 * rescaled to add up to 100% when saved. */
export default function EditPortfolioModal({ portfolio, isOpen, onClose, onSaved }) {
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState([]);
  const [companies, setCompanies] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    setName(portfolio.name || "");
    setNotes(portfolio.notes || "");
    setRows(toRows(portfolio.holdings));
    setError(null);
    loadCompanies().then(setCompanies).catch(() => setCompanies([]));
  }, [isOpen, portfolio]);

  const byTicker = useMemo(() => Object.fromEntries((companies || []).map((c) => [c.ticker, c])), [companies]);
  const tickers = rows.map((r) => r.ticker.trim().toUpperCase());
  const total = rows.reduce((s, r) => s + (Number(r.weight) > 0 ? Number(r.weight) : 0), 0);

  // Why a row can't be saved (null = fine), and a softer note for the rest.
  const rowProblem = (r, i) => {
    const t = tickers[i];
    if (!t) return "Type a ticker";
    if (tickers.indexOf(t) !== i) return `${t} is in the list twice`;
    if (!(Number(r.weight) > 0)) return "The weight must be above 0";
    if (companies && !byTicker[t] && t !== r.original) return "No market data for this ticker: check it, or import it on Market Data first";
    return null;
  };
  const rowNote = (r, i) => {
    const t = tickers[i];
    if (companies && t && !byTicker[t]) return "No market data yet: no prices for the metrics";
    if (r.original && t !== r.original) return `Was ${r.original}`;
    if (!r.original) return "New";
    return null;
  };
  const problems = rows.map(rowProblem);
  const firstProblem = !rows.length ? "Keep at least one holding" : problems.find(Boolean);

  const update = (id, patch) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const remove = (id) => setRows((rs) => rs.filter((r) => r.id !== id));
  // New companies start at an equal share (the others keep theirs; all are rescaled on save).
  const add = (list) => {
    const added = list.filter((t) => !tickers.includes(t));
    if (!added.length) return;
    const share = (100 / (rows.length + added.length)).toFixed(2);
    setRows((rs) => [...rs, ...added.map((t) => ({ id: newId(), ticker: t, original: null, weight: share }))]);
  };
  const equalWeights = () => setRows((rs) => rs.map((r) => ({ ...r, weight: (100 / rs.length).toFixed(2) })));

  const save = async (e) => {
    e.preventDefault();
    if (!name.trim()) return setError("Name the portfolio");
    if (firstProblem) return setError(firstProblem);
    setSaving(true);
    setError(null);
    try {
      const { data } = await apiClient.put(`/api/portfolios/${portfolio._key}`, {
        name: name.trim(),
        notes: notes.trim() || null,
        holdings: rows.map((r, i) => ({ ticker: tickers[i], weight: Number(r.weight) })),
      });
      toast.success(`Portfolio "${data.name}" saved with ${rows.length} holding${rows.length === 1 ? "" : "s"}`);
      onSaved(data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Edit portfolio"
      maxWidth={760}
      headerActions={
        <button className="close-btn" style={{ position: "static" }} type="submit" form="edit-portfolio" title="Save" aria-label="Save" disabled={saving}>
          <SaveIcon width={18} height={18} />
        </button>
      }
    >
      <form id="edit-portfolio" onSubmit={save}>
        <div className="order-inputs" style={{ marginBottom: 12 }}>
          <div style={{ flex: "2 1 260px" }}>
            <label htmlFor="edit-portfolio-name">Name <Req /></label>
            <input id="edit-portfolio-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div style={{ flex: "3 1 300px" }}>
            <label htmlFor="edit-portfolio-notes">Notes</label>
            <input id="edit-portfolio-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
          <label style={{ margin: 0 }}>Holdings <Req /></label>
          <button type="button" className="btn secondary" style={{ padding: "3px 10px", fontSize: "0.78rem" }} onClick={equalWeights} disabled={!rows.length} title="Give every holding the same weight">
            Equal weights
          </button>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="order-table edit-holdings-table">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Ticker</th>
                <th style={{ textAlign: "left" }}>Company</th>
                <th title="Typed as a percentage; all weights are rescaled to add up to 100% when saved">Weight (%)</th>
                <th title="The weight after rescaling to 100%">Saved as</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const problem = problems[i];
                const note = rowNote(r, i);
                const w = Number(r.weight);
                return (
                  <tr key={r.id}>
                    <td style={{ textAlign: "left" }}>
                      <input
                        className="num-input"
                        style={{ width: 90, textAlign: "left", textTransform: "uppercase" }}
                        value={r.ticker}
                        onChange={(e) => update(r.id, { ticker: e.target.value.toUpperCase() })}
                        aria-label="Ticker"
                        title="Change the ticker to replace this company"
                      />
                    </td>
                    <td style={{ textAlign: "left", whiteSpace: "normal", minWidth: 200 }}>
                      <div>{byTicker[tickers[i]]?.name || "–"}</div>
                      {problem ? (
                        <div className="error-text" style={{ fontSize: "0.76rem" }}>{problem}</div>
                      ) : note ? (
                        <div className={note.startsWith("No market") ? "warn-text" : "muted"} style={{ fontSize: "0.76rem" }}>{note}</div>
                      ) : null}
                    </td>
                    <td>
                      <input
                        className="num-input"
                        type="number"
                        min="0"
                        step="0.01"
                        style={{ width: 90 }}
                        value={r.weight}
                        onChange={(e) => update(r.id, { weight: e.target.value })}
                        aria-label={`Weight of ${r.ticker || "this holding"}`}
                      />
                    </td>
                    <td className="muted">{w > 0 && total > 0 ? `${((w / total) * 100).toFixed(2)}%` : "–"}</td>
                    <td>
                      <button type="button" className="icon-btn" onClick={() => remove(r.id)} title={`Remove ${r.ticker || "this row"}`} aria-label={`Remove ${r.ticker || "this row"}`}>
                        <TrashIcon width={16} height={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} style={{ textAlign: "left", fontWeight: 600 }}>{rows.length} holding{rows.length === 1 ? "" : "s"}</td>
                <td style={{ fontWeight: 600 }} className={Math.abs(total - 100) > 0.05 ? "warn-text" : ""} title="Rescaled to 100% when saved">{total.toFixed(2)}%</td>
                <td style={{ fontWeight: 600 }}>{rows.length ? "100.00%" : "–"}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        <div style={{ marginTop: 10 }}>
          <label>Add companies</label>
          <TickerPicker value={tickers} onChange={add} showChips={false} placeholder="Type a ticker or company name, then Enter" />
        </div>
        <p className="muted" style={{ margin: "8px 0 0", fontSize: "0.8rem" }}>
          Weights don't need to add up to 100: they are rescaled when saved. The portfolio's metrics, chart and forecast are recalculated for the new holdings.
        </p>
        {error && <p className="error-text" style={{ margin: "8px 0 0" }}>{error}</p>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn" disabled={saving}>
            <SaveIcon width={15} height={15} /> {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
