import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiClient } from "../api/client";
import PredictionPanel from "../features/predictions/PredictionPanel";
import { CloseIcon } from "../layout/icons";
import { INTERVALS, filterByInterval } from "../utils/dateRanges";

function fmtPct(v) {
  return v === null || v === undefined ? "-" : `${(Number(v) * 100).toFixed(2)}%`;
}
function fmtNum(v) {
  return v === null || v === undefined ? "-" : Number(v).toFixed(2);
}
function changeColor(value) {
  if (value === null || value === undefined || value === 0) return "var(--color-text-primary)";
  return value > 0 ? "#16a34a" : "#dc2626";
}
function fmtLarge(v) {
  if (v === null || v === undefined) return "-";
  const n = Number(v);
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n.toFixed(0)}`;
}


export default function CompanyDetailPage() {
  const { ticker } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [range, setRange] = useState("1Y");

  useEffect(() => {
    setDetail(null);
    setError(null);
    apiClient
      .get(`/api/companies/${ticker}`)
      .then((res) => setDetail(res.data))
      .catch((err) => setError(err.response?.data?.error || err.message));
  }, [ticker]);

  const CloseButton = (
    <button className="close-btn" onClick={() => navigate("/")} title="Back to company list" aria-label="Back to company list">
      <CloseIcon />
    </button>
  );

  if (error)
    return (
      <div className="card error-text" style={{ position: "relative" }}>
        {CloseButton}
        {error}
      </div>
    );
  if (!detail)
    return (
      <div className="card muted" style={{ position: "relative" }}>
        {CloseButton}
        Loading...
      </div>
    );

  const { company, stats, ratios, history } = detail;
  const dayChangePct =
    stats.current_price != null && stats.previous_close
      ? ((stats.current_price - stats.previous_close) / stats.previous_close) * 100
      : null;

  return (
    <div>
      <div className="card" style={{ position: "relative" }}>
        {CloseButton}
        <h2 style={{ paddingRight: 48 }}>{ticker} — {company.name}</h2>
        <p className="muted">{company.sector} / {company.industry}</p>
        <div className="filters-grid">
          <div>
            <strong>Price</strong>
            <div style={{ color: changeColor(dayChangePct), fontWeight: 600 }}>
              {stats.current_price != null ? `$${Number(stats.current_price).toFixed(2)}` : "-"}
              {dayChangePct !== null && ` (${dayChangePct > 0 ? "+" : ""}${dayChangePct.toFixed(2)}%)`}
            </div>
          </div>
          <div><strong>Market Cap</strong><div>{fmtLarge(stats.market_cap)}</div></div>
          <div><strong>Trailing P/E</strong><div>{fmtNum(stats.trailing_pe)}</div></div>
          <div><strong>Beta</strong><div>{fmtNum(stats.beta)}</div></div>
          <div><strong>ROE</strong><div>{fmtPct(ratios.roe)}</div></div>
          <div><strong>ROA</strong><div>{fmtPct(ratios.roa)}</div></div>
          <div><strong>Debt/Equity</strong><div>{fmtNum(ratios.debt_to_equity)}</div></div>
          <div><strong>Current Ratio</strong><div>{fmtNum(ratios.current_ratio)}</div></div>
          <div><strong>Gross Margin</strong><div>{fmtPct(ratios.gross_margin)}</div></div>
          <div><strong>Net Margin</strong><div>{fmtPct(ratios.net_margin)}</div></div>
          <div><strong>Revenue Growth YoY</strong><div>{fmtPct(ratios.revenue_growth_yoy)}</div></div>
        </div>
      </div>

      {(() => {
        const rangeHistory = filterByInterval(history, range);
        const periodChangePct =
          rangeHistory.length >= 2 && rangeHistory[0].close
            ? ((rangeHistory[rangeHistory.length - 1].close - rangeHistory[0].close) / rangeHistory[0].close) * 100
            : null;
        return (
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <h3 style={{ margin: 0 }}>Price history</h3>
                {periodChangePct !== null && (
                  <span style={{ color: changeColor(periodChangePct), fontWeight: 600 }}>
                    {periodChangePct > 0 ? "+" : ""}{periodChangePct.toFixed(2)}% ({range})
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                {INTERVALS.map((iv) => (
                  <button
                    key={iv.key}
                    className={range === iv.key ? "btn" : "btn secondary"}
                    style={{ padding: "4px 10px", fontSize: "0.78rem" }}
                    onClick={() => setRange(iv.key)}
                  >
                    {iv.key}
                  </button>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={rangeHistory}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={40} />
                <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Line type="monotone" dataKey="close" stroke={changeColor(periodChangePct)} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        );
      })()}

      <PredictionPanel ticker={ticker} />
    </div>
  );
}
