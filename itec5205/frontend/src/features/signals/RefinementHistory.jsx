import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../../api/client";
import { changeColor } from "../predictions/ForecastTables";

const pct = (v) => (v === null || v === undefined ? "-" : `${(v * 100).toFixed(2)}%`);

/** Refinement loop history (RQ3): every iteration of this pool's tree with
 *  the metrics of the latest RL portfolio trained on it. */
export default function RefinementHistory({ poolId, onSelectPool, refreshKey }) {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    apiClient
      .get(`/api/pools/${poolId}/lineage`)
      .then((res) => setRows(res.data.iterations))
      .catch(() => setRows(null));
  }, [poolId, refreshKey]);

  if (!rows || rows.length < 2) return null;

  return (
    <div className="card">
      <h3>Refinement history</h3>
      <p className="muted">
        Each iteration drops companies by the chosen rule (keep only Strong, or drop Weak &amp; Avoid), then RL is
        retrained on what's left. Compare the resulting portfolios across iterations.
      </p>
      <table>
        <thead>
          <tr>
            <th>Iteration</th>
            <th style={{ textAlign: "left" }}>Pool</th>
            <th>Companies</th>
            <th style={{ textAlign: "left" }}>Dropped</th>
            <th>RL portfolio</th>
            <th>1Y return</th>
            <th>Volatility</th>
            <th>Sharpe</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.pool_id} style={r.pool_id === poolId ? { background: "var(--color-bg-secondary)" } : undefined}>
              <td>{r.iteration}</td>
              <td style={{ textAlign: "left" }}>
                <a onClick={() => onSelectPool?.(r.pool_id)} style={{ cursor: "pointer" }}>{r.name}</a>
              </td>
              <td>{r.tickers}</td>
              <td style={{ textAlign: "left" }} className="muted">{r.dropped.length ? r.dropped.join(", ") : "-"}</td>
              <td>
                {r.portfolio ? (
                  <Link to={`/portfolios/${r.portfolio.portfolio_id}`}>{r.portfolio.holdings} holdings</Link>
                ) : (
                  <span className="muted">not trained yet</span>
                )}
              </td>
              <td style={{ color: changeColor(r.portfolio?.annual_return), fontWeight: 600 }}>{pct(r.portfolio?.annual_return)}</td>
              <td>{pct(r.portfolio?.expected_volatility)}</td>
              <td>{r.portfolio?.sharpe_ratio?.toFixed(2) ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
