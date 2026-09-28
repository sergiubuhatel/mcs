import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { clearSelected } from "../companies/companiesSlice";
import { describeFilters } from "../companies/filterFields";
import { createRequested } from "./poolsSlice";
import { BookmarkPlusIcon } from "../../layout/icons";

// Name used when auto-naming is on: the screener's filled-in filters, or --
// if the pool was hand-picked with no filters -- its first few tickers.
function autoPoolName(filters, tickers) {
  const described = describeFilters(filters);
  if (described) return described;
  const shown = tickers.slice(0, 5).join(", ");
  return tickers.length > 5 ? `${shown} +${tickers.length - 5} more` : shown;
}

export default function SavePoolForm() {
  const dispatch = useDispatch();
  const { selected, filters } = useSelector((s) => s.companies);
  const { creating, error } = useSelector((s) => s.pools);
  const [name, setName] = useState("");
  const [autoName, setAutoName] = useState(true);

  const tickers = Object.keys(selected);
  if (tickers.length === 0) return null;

  const generated = autoPoolName(filters, tickers);
  const effectiveName = autoName ? generated : name;

  const onAutoNameChange = (checked) => {
    // Unchecking starts manual editing from the generated name rather than blank.
    if (!checked) setName(generated);
    setAutoName(checked);
  };

  const submit = (e) => {
    e.preventDefault();
    if (!effectiveName.trim()) return;
    dispatch(createRequested({ name: effectiveName.trim(), tickers, filters: { sector: filters.sector, industry: filters.industry } }));
    setName("");
    dispatch(clearSelected());
  };

  return (
    <form className="card" onSubmit={submit} style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <strong style={{ whiteSpace: "nowrap" }}>{tickers.length} selected</strong>
      <label style={{ display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap", margin: 0 }}>
        <input type="checkbox" checked={autoName} onChange={(e) => onAutoNameChange(e.target.checked)} />
        Auto name
      </label>
      <input
        placeholder="Pool name, e.g. 'Low-debt tech'"
        value={effectiveName}
        readOnly={autoName}
        onChange={(e) => setName(e.target.value)}
        title={autoName ? "Built from the search filters -- uncheck Auto name to edit" : undefined}
        style={{ flex: 1, padding: "6px 8px", border: "1px solid var(--color-divider)", borderRadius: 5, background: "var(--color-bg-primary)", color: autoName ? "var(--color-text-secondary, var(--color-text-primary))" : "var(--color-text-primary)" }}
      />
      <button className="btn" type="submit" disabled={creating}><BookmarkPlusIcon /> Save as pool</button>
      {error && <span className="error-text">{error}</span>}
    </form>
  );
}
