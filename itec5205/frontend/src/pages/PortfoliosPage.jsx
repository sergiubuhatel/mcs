import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { deleteRequested, fetchRequested } from "../features/portfolios/portfoliosSlice";
import ManualPortfolioForm from "../features/portfolios/ManualPortfolioForm";
import { ChevronDownIcon, ChevronRightIcon } from "../layout/icons";

function fmtPct(v) {
  return v === null || v === undefined ? "-" : `${(Number(v) * 100).toFixed(2)}%`;
}

const TICKER_PREVIEW_COUNT = 15;

function tickerPreview(holdings) {
  const tickers = holdings.map((h) => h.ticker);
  if (tickers.length <= TICKER_PREVIEW_COUNT) return tickers.join(", ");
  return `${tickers.slice(0, TICKER_PREVIEW_COUNT).join(", ")}, +${tickers.length - TICKER_PREVIEW_COUNT} more`;
}

export default function PortfoliosPage() {
  const dispatch = useDispatch();
  const { items, loading } = useSelector((s) => s.portfolios);
  const [expanded, setExpanded] = useState({});

  useEffect(() => {
    dispatch(fetchRequested());
  }, [dispatch]);

  const toggle = (key) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div>
      <ManualPortfolioForm />

      <div className="card">
        <h2>Saved portfolios</h2>
        {loading && <p className="muted">Loading...</p>}
        {items.length === 0 && !loading && <p className="muted">No portfolios yet.</p>}
        {items.map((p) => {
          const isOpen = !!expanded[p._key];
          return (
            <div key={p._key} style={{ borderTop: "1px solid var(--color-divider)", paddingTop: 10, marginTop: 10 }}>
              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", cursor: "pointer" }}
                onClick={() => toggle(p._key)}
              >
                <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                  {isOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
                  <div>
                    <div>
                      <Link to={`/portfolios/${p._key}`} onClick={(e) => e.stopPropagation()}>
                        <strong>{p.name}</strong>
                      </Link>{" "}
                      <span className="pill">{p.method}</span>
                    </div>
                    <p className="muted" style={{ margin: "2px 0 0" }}>{tickerPreview(p.holdings)}</p>
                  </div>
                </div>
                <button
                  className="btn danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    dispatch(deleteRequested(p._key));
                  }}
                >
                  Delete
                </button>
              </div>
              {isOpen && (
                <>
                  <p className="muted">
                    Expected return: {fmtPct(p.expected_return)} · Volatility: {fmtPct(p.expected_volatility)} · Sharpe:{" "}
                    {p.sharpe_ratio ?? "-"}
                  </p>
                  <table className="holdings-table">
                    <tbody>
                      {p.holdings.map((h) => (
                        <tr key={h.ticker}>
                          <td style={{ textAlign: "left" }}>
                            <Link to={`/companies/${h.ticker}`} onClick={(e) => e.stopPropagation()}>{h.ticker}</Link>
                          </td>
                          <td className="weight">{(h.weight * 100).toFixed(2)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
