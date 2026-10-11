import Req from "../../components/Req";

// The same options as "Generate low-risk / high-return portfolio with RL"
// (RLTrainingPanel), saved. Blank limits / counts = no limit / auto.
export default function PortfolioCriteriaForm({ value, onChange }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const countsInvalid =
    value.min_companies !== "" && value.max_companies !== "" && Number(value.min_companies) > Number(value.max_companies);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem" }}>
          <input type="radio" name="pc-mode" checked={value.mode === "full"} onChange={() => set({ mode: "full" })} />
          Select from every company that passed the prediction criteria
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem" }}>
          <input type="radio" name="pc-mode" checked={value.mode === "subset"} onChange={() => set({ mode: "subset" })} />
          Only companies with a steady upward trend
        </label>
      </div>
      <div className="filters-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div>
          <label>Max volatility, annual % (optional)</label>
          <input type="number" min="0" placeholder="no limit (e.g. 25)" value={value.max_volatility_pct} onChange={(e) => set({ max_volatility_pct: e.target.value })} />
        </div>
        <div>
          <label>Min annual return % (optional)</label>
          <input type="number" placeholder="no minimum (e.g. 20)" value={value.min_return_pct} onChange={(e) => set({ min_return_pct: e.target.value })} />
        </div>
        <div>
          <label>Min companies (blank = auto)</label>
          <input type="number" min="2" placeholder="auto" value={value.min_companies} onChange={(e) => set({ min_companies: e.target.value })} />
        </div>
        <div>
          <label>Max companies (blank = auto)</label>
          <input type="number" min="2" placeholder="auto" value={value.max_companies} onChange={(e) => set({ max_companies: e.target.value })} />
        </div>
        <div>
          <label>Risk aversion (higher = more conservative)<Req /></label>
          <input type="number" step="0.1" value={value.risk_aversion} onChange={(e) => set({ risk_aversion: e.target.value })} />
        </div>
        <div>
          <label>Training timesteps<Req /></label>
          <input type="number" step="1000" value={value.timesteps} onChange={(e) => set({ timesteps: e.target.value })} />
        </div>
        {value.mode === "subset" && (
          <div>
            <label>Trend window<Req /></label>
            <select value={value.trend_window_days} onChange={(e) => set({ trend_window_days: Number(e.target.value) })}>
              <option value={63}>3 months</option>
              <option value={126}>6 months</option>
              <option value={252}>1 year</option>
              <option value={504}>2 years</option>
              <option value={756}>3 years</option>
            </select>
          </div>
        )}
      </div>
      {countsInvalid && <p className="error-text" style={{ margin: 0 }}>Min companies can't be greater than max companies.</p>}
      <p className="muted" style={{ margin: 0 }}>
        With any limit or company count set, a mean-variance optimizer picks the companies first; the PPO agent then trains on
        them, and its weights are blended toward the optimizer's allocation if they miss a limit.
      </p>
    </div>
  );
}
