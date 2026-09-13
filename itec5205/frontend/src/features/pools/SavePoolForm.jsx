import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { clearSelected } from "../companies/companiesSlice";
import { createRequested } from "./poolsSlice";
import { BookmarkPlusIcon } from "../../layout/icons";

export default function SavePoolForm() {
  const dispatch = useDispatch();
  const { selected, filters } = useSelector((s) => s.companies);
  const { creating, error } = useSelector((s) => s.pools);
  const [name, setName] = useState("");

  const tickers = Object.keys(selected);
  if (tickers.length === 0) return null;

  const submit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    dispatch(createRequested({ name: name.trim(), tickers, filters: { sector: filters.sector, industry: filters.industry } }));
    setName("");
    dispatch(clearSelected());
  };

  return (
    <form className="card" onSubmit={submit} style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <strong>{tickers.length} selected</strong>
      <input
        placeholder="Pool name, e.g. 'Low-debt tech'"
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={{ flex: 1, padding: "6px 8px", border: "1px solid var(--color-divider)", borderRadius: 5, background: "var(--color-bg-primary)", color: "var(--color-text-primary)" }}
      />
      <button className="btn" type="submit" disabled={creating}><BookmarkPlusIcon /> Save as pool</button>
      {error && <span className="error-text">{error}</span>}
    </form>
  );
}
