import { useState } from "react";
import { Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { trainRequested, reset } from "./rlSlice";
import { fetchRequested as fetchPortfoliosRequested } from "../portfolios/portfoliosSlice";
import { PieChartIcon } from "../../layout/icons";

function fmtPct(v) {
  return v === null || v === undefined ? "-" : `${(Number(v) * 100).toFixed(2)}%`;
}

// Company-count inputs: blank stays blank (auto), otherwise a whole number
// between 2 (the fewest the agent can allocate across) and the pool size.
function clampCount(raw, poolSize) {
  return raw === "" ? "" : Math.max(2, Math.min(poolSize, Math.round(Number(raw))));
}

function countOrNull(v) {
  return v === "" ? null : Number(v);
}

function describeCount(min, max) {
  if (min === "" && max === "") return "which companies to keep (and how many)";
  if (min !== "" && min === max) return `the best ${min} companies`;
  if (min === "") return `which companies to keep (at most ${max})`;
  if (max === "") return `which companies to keep (at least ${min})`;
  return `which companies to keep (${min}–${max})`;
}

// Blank = no constraint / auto; otherwise a typed percentage -> fraction.
function pctOrNull(v) {
  return v === "" || v === null || v === undefined ? null : Number(v) / 100;
}

export default function RLTrainingPanel({ pool }) {
  const dispatch = useDispatch();
  const { status, progress, result, error } = useSelector((s) => s.rl);
  const [riskAversion, setRiskAversion] = useState(1.0);
  const [timesteps, setTimesteps] = useState(20000);
  const [mode, setMode] = useState("full"); // "full" | "subset"
  const [minCompanies, setMinCompanies] = useState(""); // blank = no lower bound (auto)
  const [maxCompanies, setMaxCompanies] = useState(""); // blank = no upper bound (auto)
  const [maxVolatility, setMaxVolatility] = useState(""); // annual %, blank = no ceiling
  const [minReturn, setMinReturn] = useState(""); // realized past-year return %, blank = no floor
  const [lookbackDays, setLookbackDays] = useState(252); // trading days the trend line is fit over

  const start = () => {
    dispatch(
      trainRequested({
        pool_id: pool._key,
        risk_aversion: Number(riskAversion),
        timesteps: Number(timesteps),
        portfolio_name: pool.name,
        mode,
        min_companies: countOrNull(clampCount(minCompanies, pool.tickers.length)),
        max_companies: countOrNull(clampCount(maxCompanies, pool.tickers.length)),
        lookback_days: Number(lookbackDays),
        max_volatility: pctOrNull(maxVolatility),
        min_return: pctOrNull(minReturn),
      })
    );
  };

  const countBoundsInvalid = minCompanies !== "" && maxCompanies !== "" && Number(minCompanies) > Number(maxCompanies);
  const training = status === "starting" || status === "training";
  const pct = progress && progress.total ? Math.min(100, Math.round((progress.completed / progress.total) * 100)) : 0;

  return (
    <div className="card">
      <h3>Generate low-risk / high-return portfolio with RL</h3>
      <p className="muted">Pool: <strong>{pool.name}</strong> ({pool.tickers.length} tickers) — PPO agent trained on daily returns.</p>

      <div style={{ display: "flex", gap: 16, margin: "8px 0" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem" }}>
          <input type="radio" name="rl-mode" checked={mode === "full"} onChange={() => setMode("full")} disabled={training} />
          Select from entire pool ({pool.tickers.length} tickers)
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem" }}>
          <input type="radio" name="rl-mode" checked={mode === "subset"} onChange={() => setMode("subset")} disabled={training} />
          Only companies with a steady upward trend
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
        <div>
          <label>Max volatility, annual % (optional)</label>
          <input
            type="number"
            step="1"
            min="0"
            placeholder="no limit (e.g. 25)"
            value={maxVolatility}
            onChange={(e) => setMaxVolatility(e.target.value)}
            disabled={training}
          />
        </div>
        <div>
          <label>Min annual return % (optional)</label>
          <input
            type="number"
            step="1"
            placeholder="no minimum (e.g. 20)"
            value={minReturn}
            onChange={(e) => setMinReturn(e.target.value)}
            disabled={training}
          />
        </div>
        <div>
          <label>Min companies (blank = auto)</label>
          <input
            type="number"
            step="1"
            min="2"
            max={pool.tickers.length}
            placeholder="auto"
            value={minCompanies}
            onChange={(e) => setMinCompanies(e.target.value)}
            onBlur={(e) => setMinCompanies(clampCount(e.target.value, pool.tickers.length))}
            disabled={training}
          />
        </div>
        <div>
          <label>Max companies (blank = auto)</label>
          <input
            type="number"
            step="1"
            min="2"
            max={pool.tickers.length}
            placeholder="auto"
            value={maxCompanies}
            onChange={(e) => setMaxCompanies(e.target.value)}
            onBlur={(e) => setMaxCompanies(clampCount(e.target.value, pool.tickers.length))}
            disabled={training}
          />
        </div>
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
      <p className="muted" style={{ margin: "4px 0 8px" }}>
        {mode === "subset" &&
          "Candidates: companies whose price over the trend window tracks a straight line upward (K-ratio). "}
        {mode === "full" && minCompanies === "" && maxCompanies === "" && maxVolatility === "" && minReturn === ""
          ? "No limits or company count set: the agent trains on every ticker in the pool."
          : `A mean-variance optimizer picks ${describeCount(minCompanies, maxCompanies)} from the past year of returns — the highest return under the volatility limit, or the lowest volatility above the annual return floor${
              maxVolatility === "" && minReturn === "" ? " (here: the highest Sharpe ratio, since no limits are set)" : ""
            }. The PPO agent then trains on just those, and if its weights miss a limit they are blended toward the optimizer's allocation.`}
      </p>

      {countBoundsInvalid && <p className="error-text">Min companies can't be greater than max companies.</p>}
      <button className="btn" onClick={start} disabled={training || countBoundsInvalid}>
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
              ? "Selecting companies..."
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
              <h4>
                Selected companies (straightest upward trend){result.subset_size_auto && ` — ${result.selection.length}, auto-sized`}
              </h4>
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
          <h4>
            Recommended allocation ({result.holdings?.length} companies{result.subset_size_auto ? ", auto-sized" : ""})
          </h4>
          <p className="muted">
            Annual return (past 1Y): <strong>{fmtPct(result.metrics?.annual_return)}</strong> · Volatility:{" "}
            <strong>{fmtPct(result.metrics?.expected_volatility)}</strong> · Sharpe:{" "}
            <strong>{result.metrics?.sharpe_ratio ?? "-"}</strong>
          </p>
          {result.excluded?.length > 0 && (
            <p className="error-text">
              Left out — not enough price history to estimate risk and return (needs about{" "}
              {result.excluded[0].required_days} trading days):{" "}
              {result.excluded.map((e) => `${e.ticker} (${e.days} days)`).join(", ")}
              {result.min_companies != null &&
                result.holdings?.length < result.min_companies &&
                `. Only ${result.holdings.length} companies could be used — fewer than the minimum of ${result.min_companies}.`}
            </p>
          )}
          {result.constraints && (
            <p className={result.constraints.satisfied ? "muted" : "error-text"}>
              Constraints ({[
                result.constraints.max_volatility != null && `volatility ≤ ${fmtPct(result.constraints.max_volatility)}`,
                result.constraints.min_return != null && `annual return ≥ ${fmtPct(result.constraints.min_return)}`,
              ]
                .filter(Boolean)
                .join(", ")}
              ): {result.constraints.satisfied ? "met" : "not met"}
              {result.constraints.blend > 0 &&
                ` (RL weights blended ${fmtPct(result.constraints.blend)} toward the optimizer allocation)`}
              {result.constraints.feasible === false &&
                ` — no long-only mix of this pool reached them over the past year; best achievable: ${fmtPct(
                  result.constraints.best_achievable?.annual_return
                )} annual return at ${fmtPct(result.constraints.best_achievable?.expected_volatility)} volatility`}
            </p>
          )}
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
