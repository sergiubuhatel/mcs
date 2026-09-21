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

  const start = () => {
    dispatch(
      trainRequested({
        pool_id: pool._key,
        risk_aversion: Number(riskAversion),
        timesteps: Number(timesteps),
        portfolio_name: `RL: ${pool.name}`,
      })
    );
  };

  const training = status === "starting" || status === "training";
  const pct = progress && progress.total ? Math.min(100, Math.round((progress.completed / progress.total) * 100)) : 0;

  return (
    <div className="card">
      <h3>Generate low-risk / high-return portfolio with RL</h3>
      <p className="muted">Pool: <strong>{pool.name}</strong> ({pool.tickers.length} tickers) — PPO agent trained on daily returns.</p>

      <div className="filters-grid">
        <div>
          <label>Risk aversion (higher = more conservative)</label>
          <input type="number" step="0.1" value={riskAversion} onChange={(e) => setRiskAversion(e.target.value)} disabled={training} />
        </div>
        <div>
          <label>Training timesteps</label>
          <input type="number" step="1000" value={timesteps} onChange={(e) => setTimesteps(e.target.value)} disabled={training} />
        </div>
      </div>

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
            {progress && progress.completed != null && progress.total != null
              ? `${progress.completed} / ${progress.total} (${progress.stage || "training"})`
              : "Starting..."}
          </p>
        </div>
      )}

      {status === "error" && <p className="error-text">{error}</p>}

      {status === "done" && result && (
        <div>
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
