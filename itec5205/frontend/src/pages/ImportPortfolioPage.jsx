import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { apiClient } from "../api/client";
import { InfoPanels, PageHeader, StatTiles } from "../components/PageParts";
import Req from "../components/Req";
import {
  CheckCircleIcon,
  ImageIcon,
  LayersIcon,
  PieChartIcon,
  SaveIcon,
  SpinnerIcon,
  TrendChartIcon,
  XCircleIcon,
} from "../layout/icons";

const money = (v, currency) =>
  Number.isFinite(v) ? v.toLocaleString(undefined, { style: "currency", currency: currency || "CAD" }) : "–";
const pct = (v) => (Number.isFinite(v) ? `${v.toFixed(2)}%` : "–");
const newId = () => Math.random().toString(36).slice(2, 10);
const autoName = () => `Imported · ${new Date().toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}`;

// OCR positions -> review rows. Rows for the same US-listed ticker are added
// together (a broker can show one stock on several lines); a row not priced in
// USD is likely not the NYSE/NASDAQ stock, so it starts unticked.
function toRows(positions) {
  const rows = [];
  for (const p of positions) {
    const same = p.usd && rows.find((r) => r.usd && r.ticker === p.ticker);
    if (same) {
      same.value = +(Number(same.value) + p.market_value).toFixed(2);
      same.merged += 1;
      same.checked = same.checked && p.checked;
      continue;
    }
    rows.push({
      id: newId(),
      include: p.usd,
      ticker: p.ticker,
      // A non-USD row with a US ticker is another listing: keep its own name.
      company: p.usd ? p.company || p.security : p.security,
      readAs: p.read_as,
      known: p.known,
      value: p.market_value,
      quantity: p.quantity,
      usd: p.usd,
      checked: p.checked,
      merged: 1,
      raw: p.raw,
    });
  }
  return rows;
}

function rowNotes(r) {
  const notes = [];
  if (r.readAs) notes.push({ text: `Read as ${r.readAs} — corrected from the company name`, tone: "muted" });
  if (r.merged > 1) notes.push({ text: `${r.merged} rows added together`, tone: "muted" });
  if (!r.usd) notes.push({ text: "Not priced in USD — likely not a NYSE/NASDAQ stock", tone: "warn" });
  if (!r.checked) notes.push({ text: "Value did not add up (book + change) — check it", tone: "warn" });
  if (!r.known) notes.push({ text: "Not imported yet — no prices for the portfolio's metrics", tone: "warn" });
  return notes;
}

export default function ImportPortfolioPage() {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [rows, setRows] = useState([]);
  const [name, setName] = useState("");
  const [nameTyped, setNameTyped] = useState(false);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  const read = async (chosen) => {
    if (!chosen) return;
    if (!chosen.type.startsWith("image/")) {
      setError(`${chosen.name || "That file"} is not an image — choose a PNG or JPG screenshot`);
      return;
    }
    setFile(chosen);
    setPreview(URL.createObjectURL(chosen));
    setError(null);
    setResult(null);
    setRows([]);
    setReading(true);
    try {
      const body = new FormData();
      body.append("file", chosen, chosen.name || "screenshot.png");
      const { data } = await apiClient.post("/api/portfolios/import-image", body, { headers: { "Content-Type": "multipart/form-data" } });
      setResult(data);
      setRows(toRows(data.positions));
      if (!nameTyped) setName(autoName());
      setNotes(`Imported from ${chosen.name || "a pasted screenshot"}`);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setReading(false);
    }
  };

  // Ctrl+V of a screenshot anywhere on the page.
  useEffect(() => {
    const onPaste = (e) => {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
      if (item) read(item.getAsFile());
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  const included = rows.filter((r) => r.include && r.ticker.trim() && Number(r.value) > 0);
  const includedTotal = included.reduce((s, r) => s + Number(r.value), 0);
  const weightOf = (r) => (r.include && includedTotal > 0 && Number(r.value) > 0 ? (Number(r.value) / includedTotal) * 100 : null);

  // What gets saved: one holding per ticker (an edit can make two rows the same stock).
  const holdings = useMemo(() => {
    const byTicker = new Map();
    for (const r of included) {
      const t = r.ticker.trim().toUpperCase();
      byTicker.set(t, (byTicker.get(t) || 0) + Number(r.value));
    }
    return [...byTicker].map(([ticker, value]) => ({ ticker, weight: value / includedTotal }));
  }, [included, includedTotal]);

  const update = (id, patch) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const save = async () => {
    if (!name.trim()) return setError("Name the portfolio");
    if (!holdings.length) return setError("Tick at least one position with a market value");
    setSaving(true);
    setError(null);
    try {
      const { data } = await apiClient.post("/api/portfolios", { name: name.trim(), holdings, method: "imported", notes: notes.trim() || null });
      toast.success(`Portfolio "${data.name}" created with ${holdings.length} holdings`);
      navigate(`/portfolios/${data._key}`);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      setSaving(false);
    }
  };

  const currency = result?.currency || "CAD";
  const statementTotal = result?.statement_total;
  const allRowsTotal = rows.reduce((s, r) => s + (Number(r.value) || 0), 0);
  const totalsMatch = statementTotal ? Math.abs(allRowsTotal - statementTotal) <= Math.max(1, statementTotal * 0.001) : null;
  const largest = holdings.reduce((best, h) => (!best || h.weight > best.weight ? h : best), null);
  const unknown = included.filter((r) => !r.known).length;

  const tiles = result && [
    { icon: LayersIcon, color: "#0ea5e9", label: "Positions read", value: rows.length, sub: `${included.length} ticked for the portfolio` },
    {
      icon: totalsMatch === false ? XCircleIcon : CheckCircleIcon,
      color: totalsMatch === false ? "#dc2626" : "#16a34a",
      label: "Rows add up to",
      value: money(allRowsTotal, currency),
      sub: statementTotal ? `statement total ${money(statementTotal, currency)}${totalsMatch ? " ✓" : " — check the values"}` : "no total row found to compare",
    },
    { icon: PieChartIcon, color: "#f59e0b", label: "Largest holding", value: largest ? pct(largest.weight * 100) : "–", sub: largest ? largest.ticker : "" },
    { icon: TrendChartIcon, color: unknown ? "#dc2626" : "#8b5cf6", label: "Not imported yet", value: unknown, sub: unknown ? "import them on Market Data" : "all have price history" },
  ];

  return (
    <div>
      <PageHeader
        icon={ImageIcon}
        color="#0ea5e9"
        title="Import Portfolio"
        description="Turn a screenshot of your brokerage positions into a portfolio. Only the percentages matter, so a CAD statement of US stocks works as is."
      />
      {error && (
        <p className="error-text" onClick={() => setError(null)} style={{ cursor: "pointer" }} title="Click to dismiss">{error}</p>
      )}

      {/* ---- 1. image ---- */}
      <div className="card">
        <div className="card-header">
          <span className="step-number">1</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3 style={{ margin: 0 }}>Choose an image <Req /></h3>
            <p className="muted" style={{ margin: 0 }}>A screenshot of the positions table: symbol, … market value, … change (%). Click, drop a file, or paste (Ctrl+V).</p>
          </div>
        </div>
        <div
          className={`drop-zone ${dragging ? "dragging" : ""}`}
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            read(e.dataTransfer.files?.[0]);
          }}
        >
          <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => { read(e.target.files?.[0]); e.target.value = ""; }} />
          {preview ? (
            <img src={preview} alt="Chosen statement" className="drop-preview" />
          ) : (
            <ImageIcon width={40} height={40} style={{ color: "var(--color-text-secondary)" }} />
          )}
          <div>
            {reading ? (
              <span><SpinnerIcon width={14} height={14} className="spin" /> Reading {file?.name || "the screenshot"}…</span>
            ) : file ? (
              <span><strong>{file.name || "Pasted screenshot"}</strong> · click to choose another</span>
            ) : (
              <span><strong>Choose an image</strong> or drop it here</span>
            )}
          </div>
        </div>
      </div>

      {/* ---- 2. review ---- */}
      {result && (
        <div className="card">
          <div className="card-header">
            <span className="step-number">2</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <h3 style={{ margin: 0 }}>Review the positions</h3>
              <p className="muted" style={{ margin: 0 }}>Read from the image — fix any ticker or value it got wrong, untick what should not be in the portfolio. Weights are each market value's share of the ticked total.</p>
            </div>
          </div>
          <StatTiles tiles={tiles} />
          <div style={{ overflowX: "auto" }}>
            <table className="order-table import-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }} title="In the portfolio">✓</th>
                  <th style={{ textAlign: "left" }}>Ticker</th>
                  <th style={{ textAlign: "left" }}>Company</th>
                  <th>Quantity</th>
                  <th>Market value ({currency})</th>
                  <th>Weight</th>
                  <th style={{ textAlign: "left" }}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const w = weightOf(r);
                  return (
                    <tr key={r.id} className={r.include ? "" : "excluded"} title={r.raw}>
                      <td><input type="checkbox" checked={r.include} onChange={(e) => update(r.id, { include: e.target.checked })} aria-label={`Include ${r.ticker}`} /></td>
                      <td style={{ textAlign: "left" }}>
                        <input className="num-input" style={{ width: 80, textAlign: "left", textTransform: "uppercase" }} value={r.ticker} onChange={(e) => update(r.id, { ticker: e.target.value.toUpperCase(), known: true })} />
                      </td>
                      <td style={{ textAlign: "left", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }}>{r.company || "–"}</td>
                      <td>{r.quantity ?? "–"}</td>
                      <td>
                        <input className="num-input" type="number" min="0" step="0.01" style={{ width: 120, textAlign: "right" }} value={r.value} onChange={(e) => update(r.id, { value: e.target.value, checked: true })} />
                      </td>
                      <td>
                        {w !== null && (
                          <span className="weight-cell">
                            <span className="weight-bar" style={{ width: `${Math.min(100, w * 4)}%` }} />
                            {pct(w)}
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: "left", whiteSpace: "normal", minWidth: 220 }}>
                        {rowNotes(r).map((n) => (
                          <div key={n.text} className={n.tone === "warn" ? "warn-text" : "muted"} style={{ fontSize: "0.78rem" }}>{n.text}</div>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td />
                  <td colSpan={3} style={{ textAlign: "left", fontWeight: 600 }}>{holdings.length} holdings</td>
                  <td style={{ fontWeight: 600 }}>{money(includedTotal, currency)}</td>
                  <td style={{ fontWeight: 600 }}>{included.length ? "100.00%" : "–"}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ---- 3. save ---- */}
      {result && (
        <div className="card">
          <div className="card-header">
            <span className="step-number">3</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <h3 style={{ margin: 0 }}>Save as a portfolio</h3>
              <p className="muted" style={{ margin: 0 }}>It appears in My Portfolios with its performance and forecast, and can be chosen in the Order Calculator.</p>
            </div>
          </div>
          <div className="order-inputs">
            <div style={{ flex: "2 1 320px" }}>
              <label htmlFor="import-name">Name <Req /></label>
              <input
                id="import-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameTyped(e.target.value !== "");
                }}
              />
            </div>
            <div style={{ flex: "3 1 360px" }}>
              <label htmlFor="import-notes">Notes</label>
              <input id="import-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div style={{ flex: "0 0 auto", alignSelf: "flex-end" }}>
              <button className="btn" onClick={save} disabled={saving || !holdings.length || !name.trim()}>
                <SaveIcon width={16} height={16} /> {saving ? "Saving…" : `Create portfolio (${holdings.length})`}
              </button>
            </div>
          </div>
        </div>
      )}

      <InfoPanels
        about={{
          icon: ImageIcon,
          color: "#0ea5e9",
          title: "About Import Portfolio",
          text: "Reads the positions table in a brokerage screenshot (text recognition on the server, nothing is stored until you save) and keeps each stock's share of the total market value as its weight.",
          features: [
            { icon: PieChartIcon, color: "#0ea5e9", title: "Percentages, not amounts", text: "A CAD statement of NYSE/NASDAQ stocks gives the same weights as one in USD: the currency cancels out." },
            { icon: CheckCircleIcon, color: "#16a34a", title: "Checked against the statement", text: "Each value must equal book value + change, and the rows must add up to the statement's total." },
            { icon: LayersIcon, color: "#f59e0b", title: "Same stock twice", text: "Rows for one US ticker are added together; rows not priced in USD start unticked." },
            { icon: TrendChartIcon, color: "#8b5cf6", title: "Then analyse it", text: "The saved portfolio gets the same performance, risk and forecast views as an RL one." },
          ],
        }}
        tips={[
          { title: "Crop to the table", text: "Include the header and the total row; leave out menus and other tables." },
          { title: "Hover a row", text: "Shows the text read from the image for that row, to compare with the screenshot." },
          { title: "Missing prices", text: "Stocks marked 'Not imported yet' need Market Data → import before the portfolio's metrics include them." },
        ]}
      />
    </div>
  );
}
