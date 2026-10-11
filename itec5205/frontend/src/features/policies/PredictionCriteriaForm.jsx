import Req from "../../components/Req";
import { CloseIcon, PlusIcon } from "../../layout/icons";
import { HORIZON_UNITS, MODEL_RULES, TRAINING_UNITS } from "./criteriaConfig";

const PRESETS = [
  { value: 3, unit: "days" },
  { value: 1, unit: "weeks" },
  { value: 1, unit: "months" },
  { value: 2, unit: "months" },
  { value: 3, unit: "months" },
  { value: 4, unit: "months" },
  { value: 6, unit: "months" },
];
const TRADING_DAYS = { days: 1, weeks: 5, months: 21, years: 252 };
const label = (h) => `${h.value} ${h.value === 1 ? h.unit.replace(/s$/, "") : h.unit}`;

export default function PredictionCriteriaForm({ value, onChange }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const horizons = value.horizons || [];
  const setHorizon = (i, patch) => set({ horizons: horizons.map((h, j) => (j === i ? { ...h, ...patch } : h)) });
  const has = (p) => horizons.some((h) => Number(h.value) * TRADING_DAYS[h.unit] === p.value * TRADING_DAYS[p.unit]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="filter-group">
        <h4 style={{ color: "var(--color-text-primary)", gap: 0 }}>Predict at these points in time<Req /></h4>
        <p className="muted" style={{ marginTop: 0 }}>
          Counted in business days from the last close (1 week = 5, 1 month = 21, 1 year = 252).
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {horizons.map((h, i) => (
            <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="number" min={1} value={h.value} onChange={(e) => setHorizon(i, { value: e.target.value })} style={{ width: 80 }} />
              <select value={h.unit} onChange={(e) => setHorizon(i, { unit: e.target.value })}>
                {HORIZON_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
              <span className="muted">= {Number(h.value || 0) * TRADING_DAYS[h.unit]} business days</span>
              <button
                type="button"
                className="close-btn"
                style={{ position: "static", width: 24, height: 24 }}
                onClick={() => set({ horizons: horizons.filter((_, j) => j !== i) })}
                title="Remove"
                aria-label="Remove"
              >
                <CloseIcon width={12} height={12} />
              </button>
            </div>
          ))}
          {horizons.length === 0 && <p className="error-text" style={{ margin: 0 }}>Add at least one point.</p>}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
          <button type="button" className="btn secondary" onClick={() => set({ horizons: [...horizons, { value: 1, unit: "months" }] })}>
            <PlusIcon /> Add point
          </button>
          {PRESETS.filter((p) => !has(p)).map((p) => (
            <button key={label(p)} type="button" className="btn secondary" onClick={() => set({ horizons: [...horizons, p] })}>
              + {label(p)}
            </button>
          ))}
        </div>
      </div>

      <div className="filters-grid" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
        <div>
          <label>Training window (business days)<Req /></label>
          <div style={{ display: "flex", gap: 4 }}>
            <input
              type="number"
              min={1}
              value={value.training.value}
              onChange={(e) => set({ training: { ...value.training, value: e.target.value } })}
              style={{ flex: "1 1 0", minWidth: 0 }}
            />
            <select value={value.training.unit} onChange={(e) => set({ training: { ...value.training, unit: e.target.value } })} style={{ flex: "1 1 0", minWidth: 0 }}>
              {TRAINING_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label>A company passes when<Req /></label>
          <select value={value.models} onChange={(e) => set({ models: e.target.value })}>
            {Object.entries(MODEL_RULES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div>
          <label>Min forecast change % at every point</label>
          <input type="number" step="0.1" placeholder="any rise" value={value.min_change_pct} onChange={(e) => set({ min_change_pct: e.target.value })} />
        </div>
        <div>
          <label>LSTM max epochs{value.models !== "arima" && <Req />}</label>
          <input type="number" min={1} value={value.epochs} onChange={(e) => set({ epochs: e.target.value })} disabled={value.models === "arima"} />
        </div>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem" }}>
        <input type="checkbox" checked={!!value.reuse_forecasts} onChange={(e) => set({ reuse_forecasts: e.target.checked })} />
        Reuse forecasts already trained on the same window of today's data (much faster on re-runs)
      </label>
      <p className="muted" style={{ margin: 0 }}>
        Months/years train on the exact business days stored since that date (10 years ≈ 2515 days); a company needs at least 120 days of history.
      </p>
    </div>
  );
}
