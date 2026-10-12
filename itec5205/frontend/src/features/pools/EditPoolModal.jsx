import { useEffect, useState } from "react";
import Modal from "../../components/Modal";
import Req from "../../components/Req";
import { SaveIcon } from "../../layout/icons";
import { parseTickers } from "../dataImport/ImportControls";
import TickerToggleChips from "./TickerToggleChips";

/** Edit a candidate pool: name, companies, and the (optional) mandatory and
 * excluded companies -- always / never in the portfolio RL generates from it. */
export default function EditPoolModal({ pool, onClose, onSave }) {
  const [name, setName] = useState("");
  const [tickersText, setTickersText] = useState("");
  const [mandatory, setMandatory] = useState([]);
  const [excluded, setExcluded] = useState([]);

  useEffect(() => {
    if (!pool) return;
    setName(pool.name);
    setTickersText(pool.tickers.join(", "));
    setMandatory(pool.required_tickers || []);
    setExcluded(pool.excluded_tickers || []);
  }, [pool]);

  const tickers = parseTickers(tickersText);
  // A company removed from the pool can't stay mandatory / excluded.
  const kept = mandatory.filter((t) => tickers.includes(t));
  const keptOut = excluded.filter((t) => tickers.includes(t));
  const invalid = !name.trim() || tickers.length === 0;

  const save = (e) => {
    e.preventDefault();
    if (invalid) return;
    onSave({ id: pool._key, name: name.trim(), tickers, required_tickers: kept, excluded_tickers: keptOut });
  };

  return (
    <Modal
      isOpen={!!pool}
      onClose={onClose}
      title="Edit pool"
      maxWidth={760}
      headerActions={
        <button
          className="close-btn"
          style={{ position: "static", opacity: invalid ? 0.5 : 1, cursor: invalid ? "not-allowed" : "pointer" }}
          type="submit"
          form="pool-form"
          disabled={invalid}
          title="Save"
          aria-label="Save"
        >
          <SaveIcon width={18} height={18} />
        </button>
      }
    >
      {pool && (
        <form id="pool-form" onSubmit={save} className="filters-grid" style={{ gridTemplateColumns: "1fr" }}>
          <div>
            <label>Name<Req /></label>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus style={{ width: "100%" }} />
          </div>
          <div>
            <label>Tickers<Req /> ({tickers.length})</label>
            <textarea
              value={tickersText}
              onChange={(e) => setTickersText(e.target.value.toUpperCase())}
              rows={3}
              placeholder="Comma-separated tickers, e.g. AAPL, MSFT"
              style={{ width: "100%", resize: "vertical" }}
            />
          </div>
          <TickerToggleChips
            label="Mandatory stocks"
            help="Click the companies that must be part of the portfolio generated from this pool. None selected = the optimizer and the RL agent decide."
            tickers={tickers}
            value={kept}
            onChange={setMandatory}
            variant="mandatory"
            blocked={keptOut}
            blockedLabel="is excluded — undo that first"
          />
          <TickerToggleChips
            label="Excluded stocks"
            help="Click the companies that must never be part of the portfolio generated from this pool."
            tickers={tickers}
            value={keptOut}
            onChange={setExcluded}
            variant="excluded"
            blocked={kept}
            blockedLabel="is mandatory — undo that first"
          />
        </form>
      )}
    </Modal>
  );
}
