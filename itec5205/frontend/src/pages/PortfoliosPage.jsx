import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { deleteRequested, fetchRequested } from "../features/portfolios/portfoliosSlice";
import ManualPortfolioForm from "../features/portfolios/ManualPortfolioForm";

function fmtPct(v) {
  return v === null || v === undefined ? "-" : `${(Number(v) * 100).toFixed(2)}%`;
}

export default function PortfoliosPage() {
  const dispatch = useDispatch();
  const { items, loading } = useSelector((s) => s.portfolios);

  useEffect(() => {
    dispatch(fetchRequested());
  }, [dispatch]);

  return (
    <div>
      <ManualPortfolioForm />

      <div className="card">
        <h2>Saved portfolios</h2>
        {loading && <p className="muted">Loading...</p>}
        {items.length === 0 && !loading && <p className="muted">No portfolios yet.</p>}
        {items.map((p) => (
          <div key={p._key} style={{ borderTop: "1px solid var(--color-divider)", paddingTop: 10, marginTop: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div>
                <strong>{p.name}</strong> <span className="pill">{p.method}</span>
              </div>
              <button className="btn danger" onClick={() => dispatch(deleteRequested(p._key))}>Delete</button>
            </div>
            <p className="muted">
              Expected return: {fmtPct(p.expected_return)} · Volatility: {fmtPct(p.expected_volatility)} · Sharpe:{" "}
              {p.sharpe_ratio ?? "-"}
            </p>
            <table className="holdings-table">
              <tbody>
                {p.holdings.map((h) => (
                  <tr key={h.ticker}>
                    <td style={{ textAlign: "left" }}>{h.ticker}</td>
                    <td className="weight">{(h.weight * 100).toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
