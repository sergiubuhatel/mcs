import { useState } from "react";
import { Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { trainRequested, reset } from "./rlSlice";
import { fetchRequested as fetchPortfoliosRequested } from "../portfolios/portfoliosSlice";
import { PieChartIcon } from "../../layout/icons";

function fmtPct(v) {
  return v === null || v === undefined ? "-" : `${(Number(v) * 100).toFixed(2)}%`;
}

export default function RLTrainingPanel({ pool }) {
  const dispatch = useDispatch();
  const { status, progress, result, error } = useSelector((s) => s.rl);
  const [riskAversion, setRiskAversion] = useState(1.0);
  const [timesteps, setTimesteps] = useState(20000);
  const [mode, setMode] = useState("full"); // "full" | "subset"
  const [subsetSize, setSubsetSize] = useState(Math.min(10, pool.tickers.length));
  const [lookbackDays, setLookbackDays] = useState(252); // trading days the trend line is fit over

  const start = () => {
    dispatch(
      trainRequested({
        pool_id: pool._key,
        risk_aversion: Number(riskAversion),
        timesteps: Number(timesteps),
        portfolio_name: pool.name,
        mode,
        subset_size: Math.max(2, Math.min(499, Number(subsetSize) || 2)),
        lookback_days: Number(lookbackDays),
      })
    );
  };

  const training = status === "starting" || status === "training";
  const pct = progress && progress.total ? Math.min(100, Math.round((progress.completed / progress.total) * 100)) : 0;

  return (
    <div className="card">
      <h3>Generate low-risk / high-return portfolio with RL</h3>
      <p className="muted">Pool: <strong>{pool.name}</strong> ({pool.tickers.length} tickers) — PPO agent trained on daily returns.</p>

      <div style={{ display: "flex", gap: 16, margin: "8px 0" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem" }}>
          <input type="radio" name="rl-mode" checked={mode === "full"} onChange={() => setMode("full")} disabled={training} />
          Train entire pool ({pool.tickers.length} tickers)
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem" }}>
          <input type="radio" name="rl-mode" checked={mode === "subset"} onChange={() => setMode("subset")} disabled={training} />
          Auto-select lowest-risk / highest-return subset
        </label>
      </div>

      <div className="filters-grid">
        <div>
          <label>Risk aversion (higher = more conservative)</label>
          <input type="number" step="0.1" value={riskAversion} onChange={(e) => setRiskAversion(e.target.value)} disabled={training} />
        </div>
        <div>
          <label>Training timesteps</label>
          <input type="number" step="1000" value={timesteps} onChange={(e) => setTimesteps(e.target.value)} disabled={training} />
        </div>
        {mode === "subset" && (
          <div>
            <label>Subset size</label>
            <input
              type="number"
              step="1"
              min="2"
              max={Math.min(499, pool.tickers.length)}
              value={subsetSize}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === "") {
                  setSubsetSize(raw);
                  return;
                }
                const clamped = Math.max(2, Math.min(499, pool.tickers.length, Number(raw)));
                setSubsetSize(clamped);
              }}
              onBlur={(e) => {
                if (e.target.value === "") setSubsetSize(2);
              }}
              disabled={training}
            />
          </div>
        )}
        {mode === "subset" && (
          <div>
            <label>Trend window (how far back to check for a straight line)</label>
            <select value={lookbackDays} onChange={(e) => setLookbackDays(e.target.value)} disabled={training}>
              <option value={63}>3 months</option>
              <option value={126}>6 months</option>
              <option value={252}>1 year</option>
              <option value={504}>2 years</option>
              <option value={756}>3 years</option>
            </select>
          </div>
        )}
      </div>
      {mode === "subset" && (
        <p className="muted" style={{ margin: "4px 0 8px" }}>
          Ranks the pool by how closely its price action over that window tracks a straight line upward (K-ratio: trend
          steepness relative to how tightly the price hugs that line) and trains on just the top {subsetSize}.
        </p>
      )}

      <button className="btn" onClick={start} disabled={training}>
        <PieChartIcon /> {training ? "Training..." : "Train RL portfolio"}
      </button>{" "}
      {status !== "idle" && (
        <button className="btn secondary" onClick={() => dispatch(reset())} disabled={training}>Reset</button>
      )}

      {training && (
        <div>
          <div className="progress-bar"><div style={{ width: `${pct}%` }} /></div>
          <p className="muted">
            {progress?.stage === "selecting"
              ? "Ranking pool by trend consistency..."
              : progress && progress.completed != null && progress.total != null
              ? // PPO trains in fixed-size batches (n_steps) and only stops between
                // full batches, so the real step count can slightly overshoot the
                // requested total (e.g. 20480 actual steps for a 20000 target) --
                // clamp what's displayed so it never reads as "more than 100%".
                `${Math.min(progress.completed, progress.total)} / ${progress.total} (${progress.stage || "training"})`
              : "Starting..."}
          </p>
        </div>
      )}

      {status === "error" && <p className="error-text">{error}</p>}

      {status === "done" && result && (
        <div>
          {result.selection && (
            <>
              <h4>Selected subset (straightest upward trend, past 1Y)</h4>
              <table className="holdings-table">
                <thead><tr><th>Ticker</th><th>K-ratio</th><th>Trend fit (R²)</th><th>Implied annual return</th></tr></thead>
                <tbody>
                  {result.selection.map((r) => (
                    <tr key={r.ticker}>
                      <td style={{ textAlign: "left" }}>{r.ticker}</td>
                      <td className="weight">{r.k_ratio}</td>
                      <td className="weight">{r.trend_fit_r2}</td>
                      <td className="weight">{fmtPct(r.implied_annual_return)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <h4>Recommended allocation</h4>
          <p className="muted">
            Expected annual return: <strong>{fmtPct(result.metrics?.expected_return)}</strong> · Volatility:{" "}
            <strong>{fmtPct(result.metrics?.expected_volatility)}</strong> · Sharpe:{" "}
            <strong>{result.metrics?.sharpe_ratio ?? "-"}</strong>
          </p>
          <table className="holdings-table">
            <thead><tr><th>Ticker</th><th>Weight</th></tr></thead>
            <tbody>
              {result.holdings
                ?.slice()
                .sort((a, b) => b.weight - a.weight)
                .map((h) => (
                  <tr key={h.ticker}>
                    <td style={{ textAlign: "left" }}>{h.ticker}</td>
                    <td className="weight">{(h.weight * 100).toFixed(2)}%</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <p className="muted">
            Saved as portfolio id <code>{result.portfolio_id}</code>.{" "}
            <Link to={`/portfolios/${result.portfolio_id}`}>View portfolio &amp; chart &rarr;</Link>
          </p>
          <button className="btn secondary" onClick={() => dispatch(fetchPortfoliosRequested())}>Refresh portfolios list</button>
        </div>
      )}
    </div>
  );
}
