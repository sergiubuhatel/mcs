import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import Modal from "../../components/Modal";
import Req from "../../components/Req";
import { clearSelected } from "../companies/companiesSlice";
import { describeFilters } from "../companies/filterFields";
import { createRequested } from "./poolsSlice";
import { screenCriteria } from "../companies/companiesSaga";
import { SaveIcon } from "../../layout/icons";

// Name used when auto-naming is on: the screener's filled-in filters, or --
// if the pool was hand-picked with no filters -- its first few tickers.
function autoPoolName(filters, tickers) {
  const described = describeFilters(filters);
  if (described) return described;
  const shown = tickers.slice(0, 5).join(", ");
  return tickers.length > 5 ? `${shown} +${tickers.length - 5} more` : shown;
}

/** "Create Stock Pool" dialog for the screener's selected companies. */
export default function SavePoolForm({ isOpen, onClose }) {
  const dispatch = useDispatch();
  const { selected, filters } = useSelector((s) => s.companies);
  const { creating, error } = useSelector((s) => s.pools);
  const [name, setName] = useState("");

  const tickers = Object.keys(selected);
  const generated = autoPoolName(filters, tickers);
  // Empty name = auto-named from the filters; typing renames it.
  const effectiveName = name.trim() ? name : generated;

  const submit = (e) => {
    e.preventDefault();
    if (!effectiveName.trim() || tickers.length === 0) return;
    dispatch(createRequested({ name: effectiveName.trim(), tickers, filters: screenCriteria(filters) }));
    setName("");
    dispatch(clearSelected());
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create stock pool"
      maxWidth={560}
      headerActions={
        <button
          className="close-btn"
          style={{ position: "static", opacity: creating ? 0.5 : 1 }}
          type="submit"
          form="save-pool-form"
          disabled={creating || tickers.length === 0}
          title="Save"
          aria-label="Save"
        >
          <SaveIcon width={18} height={18} />
        </button>
      }
    >
      <form id="save-pool-form" onSubmit={submit} className="filters-grid" style={{ gridTemplateColumns: "1fr" }}>
        <div>
          <label>Name<Req /></label>
          <input value={effectiveName} onChange={(e) => setName(e.target.value)} autoFocus />
          {!name.trim() && <span className="muted">Named automatically from the filters — type to rename.</span>}
        </div>
        <div>
          <label>Companies ({tickers.length})</label>
          <p className="muted" style={{ margin: 0, maxHeight: 120, overflow: "auto" }}>{tickers.join(", ") || "None selected"}</p>
        </div>
        {error && <p className="error-text">{error}</p>}
      </form>
    </Modal>
  );
}
