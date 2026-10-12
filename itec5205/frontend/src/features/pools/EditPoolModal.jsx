import { useEffect, useState } from "react";
import Modal from "../../components/Modal";
import Req from "../../components/Req";
import { CheckIcon, SaveIcon } from "../../layout/icons";
import { parseTickers } from "../dataImport/ImportControls";

/** Edit a candidate pool: name, companies, and the (optional) mandatory
 * companies -- those always kept in the portfolio RL generates from it. */
export default function EditPoolModal({ pool, onClose, onSave }) {
  const [name, setName] = useState("");
  const [tickersText, setTickersText] = useState("");
  const [mandatory, setMandatory] = useState([]);

  useEffect(() => {
    if (!pool) return;
    setName(pool.name);
    setTickersText(pool.tickers.join(", "));
    setMandatory(pool.required_tickers || []);
  }, [pool]);

  const tickers = parseTickers(tickersText);
  // A company removed from the pool can't stay mandatory.
  const kept = mandatory.filter((t) => tickers.includes(t));
  const toggle = (t) => setMandatory(kept.includes(t) ? kept.filter((x) => x !== t) : [...kept, t]);
  const invalid = !name.trim() || tickers.length === 0;

  const save = (e) => {
    e.preventDefault();
    if (invalid) return;
    onSave({ id: pool._key, name: name.trim(), tickers, required_tickers: kept });
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
          <div>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              Mandatory stocks{kept.length > 0 && <span className="count-badge">{kept.length}</span>}
              {kept.length > 0 && (
                <a onClick={() => setMandatory([])} style={{ cursor: "pointer", fontSize: "0.8rem", fontWeight: 400 }}>
                  Clear
                </a>
              )}
            </label>
            <p className="muted" style={{ margin: "2px 0 6px" }}>
              Click the companies that must be part of the portfolio generated from this pool. None selected = the optimizer
              and the RL agent decide.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {tickers.map((t) => {
              const on = kept.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  className={`ticker-chip${on ? " mandatory" : ""}`}
                  onClick={() => toggle(t)}
                  aria-pressed={on}
                  title={on ? `${t} is mandatory — click to make it optional` : `Make ${t} mandatory`}
                >
                  {on && <CheckIcon />}
                  {t}
                </button>
              );
            })}
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}
