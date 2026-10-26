import { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import { apiClient } from "../api/client";
import { InfoPanels, PageHeader } from "../components/PageParts";
import Req from "../components/Req";
import { loadCompanies } from "../components/TickerPicker";
import AllocationDonut, { SLOT_COLORS } from "../components/AllocationDonut";
import { CloseIcon, LayersIcon, PieChartIcon, PlusIcon, SaveIcon, TrendChartIcon, WorkflowIcon } from "../layout/icons";

const TOLERANCE = 0.05; // same as the backend: 33.33 × 3 is fine
const newId = () => Math.random().toString(36).slice(2, 10);
const pct = (v, digits = 2) => (Number.isFinite(v) ? `${(+v.toFixed(digits)).toFixed(digits)}%` : "–");
const fmtAlloc = (v) => (Number.isFinite(v) ? `${+v.toFixed(2)}%` : "–");
const newestFirst = (list) => [...list].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
const emptySleeve = (allocation = "") => ({ id: newId(), portfolioId: "", allocation, note: "" });

export default function CombinePortfoliosPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const darkMode = useSelector((s) => s.theme.darkMode);
  const colors = SLOT_COLORS[darkMode ? "dark" : "light"];
  const [portfolios, setPortfolios] = useState([]);
  const [companies, setCompanies] = useState({});
  const [editId, setEditId] = useState(params.get("id") || "");
  const [sleeves, setSleeves] = useState([emptySleeve(100)]);
  const [name, setName] = useState("");
  const [nameTyped, setNameTyped] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiClient.get("/api/portfolios").then((r) => setPortfolios(newestFirst(r.data.portfolios))).catch((err) => setError(err.message));
    loadCompanies().then((list) => setCompanies(Object.fromEntries(list.map((c) => [c.ticker, c.name])))).catch(() => {});
  }, []);

  const byId = useMemo(() => Object.fromEntries(portfolios.map((p) => [p._key, p])), [portfolios]);
  const combinedSaved = portfolios.filter((p) => p.method === "combined");

  // Open a saved portfolio of portfolios (its parts as they are now; a part
  // deleted since keeps its snapshot so nothing silently disappears).
  useEffect(() => {
    if (!editId || !portfolios.length) return;
    const doc = byId[editId];
    if (!doc?.sleeves) return;
    setSleeves(doc.sleeves.map((s) => ({ id: newId(), portfolioId: s.portfolio_id, allocation: s.allocation, note: s.note || "", snapshot: s })));
    setName(doc.name);
    setNameTyped(true);
    setNotes(doc.notes || "");
  }, [editId, portfolios]); // eslint-disable-line react-hooks/exhaustive-deps

  const openSaved = (id) => {
    setEditId(id);
    setParams(id ? { id } : {}, { replace: true });
    if (!id) {
      setSleeves([emptySleeve(100)]);
      setName("");
      setNameTyped(false);
      setNotes("");
    }
  };

  const update = (id, patch) => setSleeves((ss) => ss.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const allocSum = sleeves.reduce((s, x) => s + (Number(x.allocation) || 0), 0);
  const addSleeve = () => setSleeves((ss) => [...ss, emptySleeve(Math.max(0, +(100 - allocSum).toFixed(2)) || "")]);
  const splitEqually = () => {
    const n = sleeves.length;
    const base = Math.floor((100 / n) * 100) / 100;
    setSleeves((ss) => ss.map((s, i) => ({ ...s, allocation: i === 0 ? +(100 - base * (n - 1)).toFixed(2) : base })));
  };

  // Each chosen part with its holdings (live, or the saved snapshot if deleted).
  const parts = sleeves
    .map((s, i) => {
      const doc = byId[s.portfolioId];
      const holdings = doc?.holdings || s.snapshot?.holdings;
      if (!s.portfolioId || !holdings) return null;
      return { ...s, index: i, name: doc?.name || `${s.snapshot.name} (deleted)`, holdings, alloc: Number(s.allocation) || 0, missing: !doc };
    })
    .filter(Boolean);

  const combined = useMemo(() => {
    const total = new Map();
    for (const p of parts) {
      for (const h of p.holdings) {
        const row = total.get(h.ticker) || { ticker: h.ticker, weight: 0, from: [] };
        row.weight += (p.alloc / (allocSum || 1)) * h.weight * 100;
        row.from.push(p.index);
        total.set(h.ticker, row);
      }
    }
    return [...total.values()].sort((a, b) => b.weight - a.weight);
  }, [parts, allocSum]);

  const autoName = parts.map((p) => `${fmtAlloc(p.alloc)} ${p.name}`).join(" + ");
  useEffect(() => {
    if (!nameTyped) setName(autoName);
  }, [autoName, nameTyped]);

  const ids = sleeves.map((s) => s.portfolioId).filter(Boolean);
  const duplicate = ids.length !== new Set(ids).size;
  const sumOk = Math.abs(allocSum - 100) <= TOLERANCE;
  const problem = !parts.length
    ? "Choose at least one portfolio"
    : sleeves.some((s) => !s.portfolioId)
    ? "Choose a portfolio in every row (or remove the empty row)"
    : duplicate
    ? "A portfolio can only be added once"
    : sleeves.some((s) => !(Number(s.allocation) > 0))
    ? "Every portfolio needs an allocation above 0%"
    : !sumOk
    ? `Allocations add up to ${+allocSum.toFixed(2)}% — they must add up to 100%`
    : !name.trim()
    ? "Name the portfolio"
    : null;

  const save = async () => {
    if (problem) return setError(problem);
    setSaving(true);
    setError(null);
    const body = {
      name: name.trim(),
      notes: notes.trim() || null,
      sleeves: sleeves.map((s) => ({ portfolio_id: s.portfolioId, allocation: Number(s.allocation), note: s.note })),
    };
    try {
      const { data } = editId ? await apiClient.put(`/api/portfolios/combined/${editId}`, body) : await apiClient.post("/api/portfolios/combined", body);
      toast.success(`"${data.name}" ${editId ? "updated" : "created"} — ${data.holdings.length} holdings`);
      navigate(`/portfolios/${data._key}`);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      setSaving(false);
    }
  };

  const choosable = portfolios.filter((p) => p._key !== editId);

  return (
    <div>
      <PageHeader
        icon={PieChartIcon}
        color="#0ea5e9"
        title="Portfolio of Portfolios"
        description="Combine saved portfolios into one: give each a share of the total, e.g. 50% rotating, 25% long-term core, 25% 10-year growth."
      />
      {error && (
        <p className="error-text" onClick={() => setError(null)} style={{ cursor: "pointer" }} title="Click to dismiss">{error}</p>
      )}

      {/* ---- 1. parts ---- */}
      <div className="card">
        <div className="card-header" style={{ flexWrap: "wrap" }}>
          <span className="step-number">1</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3 style={{ margin: 0 }}>Choose the portfolios and their share</h3>
            <p className="muted" style={{ margin: 0 }}>Each portfolio keeps its own weights inside its share; a stock in several is added up.</p>
          </div>
          <div style={{ minWidth: 260 }}>
            <select value={editId} onChange={(e) => openSaved(e.target.value)} aria-label="Open a saved portfolio of portfolios">
              <option value="">— new portfolio of portfolios —</option>
              {combinedSaved.map((p) => <option key={p._key} value={p._key}>Edit: {p.name}</option>)}
            </select>
          </div>
        </div>
        <table className="order-table sleeve-table">
          <thead>
            <tr>
              <th style={{ width: 14 }} />
              <th style={{ textAlign: "left" }}>Portfolio <Req /></th>
              <th style={{ width: 130 }}>Share of total <Req /></th>
              <th style={{ textAlign: "left", width: "32%" }}>Note</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {sleeves.map((s, i) => (
              <tr key={s.id}>
                <td><span className="sleeve-swatch" style={{ background: colors[i % colors.length] }} /></td>
                <td style={{ textAlign: "left" }}>
                  <select value={s.portfolioId} onChange={(e) => update(s.id, { portfolioId: e.target.value, snapshot: null })}>
                    <option value="">— choose a portfolio —</option>
                    {s.snapshot && !byId[s.portfolioId] && <option value={s.portfolioId}>{s.snapshot.name} (deleted, saved copy)</option>}
                    {choosable.map((p) => (
                      <option key={p._key} value={p._key} disabled={p._key !== s.portfolioId && ids.includes(p._key)}>
                        {p.name} ({p.holdings.length} stocks)
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <div className="setting-suffix">
                    <input className="num-input" type="number" min="0" max="100" step="0.01" value={s.allocation} style={{ textAlign: "right" }} onChange={(e) => update(s.id, { allocation: e.target.value })} />
                    <span>%</span>
                  </div>
                </td>
                <td style={{ textAlign: "left" }}>
                  <input value={s.note} placeholder="e.g. Review every 3 months" onChange={(e) => update(s.id, { note: e.target.value })} />
                </td>
                <td>
                  <button className="icon-btn" title="Remove" aria-label="Remove" onClick={() => setSleeves((ss) => ss.filter((x) => x.id !== s.id))} disabled={sleeves.length === 1}>
                    <CloseIcon width={14} height={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td />
              <td style={{ textAlign: "left" }}>
                <button className="btn secondary" onClick={addSleeve} disabled={sleeves.length >= choosable.length}>
                  <PlusIcon width={14} height={14} /> Add portfolio
                </button>{" "}
                <button className="btn secondary" onClick={splitEqually} disabled={sleeves.length < 2} title="Give every portfolio the same share">
                  Split equally
                </button>
              </td>
              <td style={{ fontWeight: 700, color: sumOk ? "#16a34a" : "#dc2626" }} title="Must add up to 100%">
                {+allocSum.toFixed(2)}%
              </td>
              <td colSpan={2} style={{ textAlign: "left" }} className="muted">
                {sumOk ? "adds up to 100%" : allocSum < 100 ? `${+(100 - allocSum).toFixed(2)}% left to allocate` : `${+(allocSum - 100).toFixed(2)}% too much`}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ---- 2. overview ---- */}
      {parts.length > 0 && (
        <div className="card">
          <div className="card-header">
            <span className="step-number">2</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <h3 style={{ margin: 0 }}>The total portfolio</h3>
              <p className="muted" style={{ margin: 0 }}>Weights are shares of the whole portfolio (allocation × the stock's weight in its portfolio); the smaller number is the weight inside its own portfolio.</p>
            </div>
          </div>
          <div className="sleeve-overview">
            <div className="sleeve-donut">
              <AllocationDonut parts={parts.map((p) => ({ key: p.id, label: p.name, value: p.alloc }))} colors={parts.map((p) => colors[p.index % colors.length])} />
            </div>
            <div className="sleeve-cards">
              {parts.map((p) => {
                const color = colors[p.index % colors.length];
                return (
                  <div key={p.id} className="sleeve-card" style={{ borderColor: color }}>
                    <div className="sleeve-card-head" style={{ background: `${color}1f` }}>
                      <span className="sleeve-alloc" style={{ color }}>{fmtAlloc(p.alloc)}</span>
                      <div style={{ minWidth: 0 }}>
                        <div className="sleeve-name">{p.name}</div>
                        {p.note && <div className="muted" style={{ fontSize: "0.8rem" }}>{p.note}</div>}
                      </div>
                    </div>
                    <table className="order-table sleeve-card-table">
                      <thead>
                        <tr>
                          <th style={{ textAlign: "left", width: 72 }}>Ticker</th>
                          <th style={{ textAlign: "left" }}>Company</th>
                          <th style={{ width: 118 }}>Weight</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...p.holdings].sort((a, b) => b.weight - a.weight).map((h) => (
                          <tr key={h.ticker}>
                            <td style={{ textAlign: "left", fontWeight: 700 }}>{h.ticker}</td>
                            <td style={{ textAlign: "left", overflow: "hidden", textOverflow: "ellipsis" }} title={companies[h.ticker] || ""}>{companies[h.ticker] || "–"}</td>
                            <td>
                              <strong>{pct((p.alloc / (allocSum || 1)) * h.weight * 100)}</strong>
                              <span className="muted" style={{ fontSize: "0.75rem", marginLeft: 6 }}>{pct(h.weight * 100, 1)}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          </div>
          <details className="sleeve-combined">
            <summary>All {combined.length} holdings of the total portfolio</summary>
            <table className="order-table">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Ticker</th>
                  <th style={{ textAlign: "left" }}>Company</th>
                  <th style={{ textAlign: "left" }}>From</th>
                  <th>Weight</th>
                </tr>
              </thead>
              <tbody>
                {combined.map((h) => (
                  <tr key={h.ticker}>
                    <td style={{ textAlign: "left", fontWeight: 700 }}>{h.ticker}</td>
                    <td style={{ textAlign: "left" }}>{companies[h.ticker] || "–"}</td>
                    <td style={{ textAlign: "left" }}>
                      {h.from.map((i) => <span key={i} className="sleeve-swatch" style={{ background: colors[i % colors.length], marginRight: 4 }} title={parts.find((p) => p.index === i)?.name} />)}
                    </td>
                    <td>{pct(h.weight)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      )}

      {/* ---- 3. save ---- */}
      {parts.length > 0 && (
        <div className="card">
          <div className="card-header">
            <span className="step-number">3</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <h3 style={{ margin: 0 }}>{editId ? "Update the portfolio" : "Save as a portfolio"}</h3>
              <p className="muted" style={{ margin: 0 }}>It appears in My Portfolios with its performance and forecast, and can be chosen in the Order Calculator.</p>
            </div>
          </div>
          <div className="order-inputs">
            <div style={{ flex: "2 1 320px" }}>
              <label htmlFor="combo-name">Name <Req /></label>
              <input
                id="combo-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameTyped(e.target.value !== "");
                }}
              />
            </div>
            <div style={{ flex: "3 1 360px" }}>
              <label htmlFor="combo-notes">Notes</label>
              <input id="combo-notes" value={notes} placeholder="e.g. Lightweight allocation for a smaller account" onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div style={{ flex: "0 0 auto", alignSelf: "flex-end" }}>
              <button className="btn" onClick={save} disabled={saving || !!problem} title={problem || ""}>
                <SaveIcon width={16} height={16} /> {saving ? "Saving…" : editId ? "Update portfolio" : `Create portfolio (${combined.length})`}
              </button>
            </div>
          </div>
          {problem && <p className="muted" style={{ margin: "8px 0 0" }}>{problem}.</p>}
        </div>
      )}

      <InfoPanels
        about={{
          icon: PieChartIcon,
          color: "#0ea5e9",
          title: "About Portfolio of Portfolios",
          text: "Splits one account between several strategies. Each saved portfolio becomes a part of the total with the share you give it; its stocks keep their weights inside that share.",
          features: [
            { icon: LayersIcon, color: "#2a78d6", title: "Any saved portfolio", text: "RL-built, hand-built, imported from a statement, or another portfolio of portfolios." },
            { icon: PieChartIcon, color: "#1baf7a", title: "Shares add up to 100%", text: "Split equally, or type each share; the donut and the cards update as you type." },
            { icon: WorkflowIcon, color: "#eb6834", title: "A copy of each part", text: "The parts are saved with the portfolio, so editing or deleting one later does not change it — open it here and update to take the changes." },
            { icon: TrendChartIcon, color: "#6250d6", title: "Then trade it", text: "Choose it in the Order Calculator for the shares to buy in each account." },
          ],
        }}
        tips={[
          { title: "Name the parts", text: "A note per part (\"review every 3 months\", \"keep 10 years\") is saved with it." },
          { title: "Fewer funds, fewer stocks", text: "A small account cannot buy many companies: keep the parts small and check the Order Calculator's result." },
          { title: "Edit later", text: "Pick it in the list at the top of step 1 to change the shares or the parts." },
        ]}
      />
    </div>
  );
}
