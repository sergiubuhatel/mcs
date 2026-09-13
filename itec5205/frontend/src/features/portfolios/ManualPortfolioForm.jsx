import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { createRequested } from "./portfoliosSlice";
import { PlusIcon, SaveIcon, TrashIcon } from "../../layout/icons";

export default function ManualPortfolioForm() {
  const dispatch = useDispatch();
  const { creating, error } = useSelector((s) => s.portfolios);
  const [name, setName] = useState("");
  const [rows, setRows] = useState([{ ticker: "", weight: "" }]);

  const updateRow = (i, field, value) => {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)));
  };
  const addRow = () => setRows((r) => [...r, { ticker: "", weight: "" }]);
  const removeRow = (i) => setRows((r) => r.filter((_, idx) => idx !== i));

  const submit = (e) => {
    e.preventDefault();
    const holdings = rows
      .filter((r) => r.ticker && r.weight)
      .map((r) => ({ ticker: r.ticker.toUpperCase(), weight: Number(r.weight) }));
    if (!name.trim() || holdings.length === 0) return;
    dispatch(createRequested({ name: name.trim(), holdings, method: "manual" }));
    setName("");
    setRows([{ ticker: "", weight: "" }]);
  };

  return (
    <form className="card" onSubmit={submit}>
      <h3>Build a manual portfolio</h3>
      <div className="filters-grid">
        <div>
          <label>Portfolio name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My portfolio" />
        </div>
      </div>
      {rows.map((row, i) => (
        <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
          <input placeholder="Ticker" value={row.ticker} onChange={(e) => updateRow(i, "ticker", e.target.value)} style={{ width: 100 }} />
          <input placeholder="Weight" type="number" step="0.01" value={row.weight} onChange={(e) => updateRow(i, "weight", e.target.value)} style={{ width: 100 }} />
          <button type="button" className="btn secondary" onClick={() => removeRow(i)}>Remove</button>
        </div>
      ))}
      <button type="button" className="btn secondary" onClick={addRow}>+ Add ticker</button>{" "}
      <button className="btn" type="submit" disabled={creating}>Save portfolio</button>
      <p className="muted">Weights don't need to sum to 1 — they're normalized automatically.</p>
      {error && <p className="error-text">{error}</p>}
    </form>
  );
}
