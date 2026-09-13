import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiClient } from "../api/client";
import PredictionPanel from "../features/predictions/PredictionPanel";

function fmtPct(v) {
  return v === null || v === undefined ? "-" : `${(Number(v) * 100).toFixed(2)}%`;
}

export default function CompanyDetailPage() {
  const { ticker } = useParams();
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setDetail(null);
    setError(null);
    apiClient
      .get(`/api/companies/${ticker}`)
      .then((res) => setDetail(res.data))
      .catch((err) => setError(err.response?.data?.error || err.message));
  }, [ticker]);

  if (error) return <div className="card error-text">{error}</div>;
  if (!detail) return <div className="card muted">Loading...</div>;

  const { company, stats, ratios, history } = detail;

  return (
    <div>
      <div className="card">
        <h2>{ticker} — {company.name}</h2>
        <p className="muted">{company.sector} / {company.industry}</p>
        <div className="filters-grid">
          <div><strong>Price</strong><div>{stats.current_price ?? "-"}</div></div>
          <div><strong>Market Cap</strong><div>{stats.market_cap ?? "-"}</div></div>
          <div><strong>Trailing P/E</strong><div>{stats.trailing_pe ?? "-"}</div></div>
          <div><strong>Beta</strong><div>{stats.beta ?? "-"}</div></div>
          <div><strong>ROE</strong><div>{fmtPct(ratios.roe)}</div></div>
          <div><strong>ROA</strong><div>{fmtPct(ratios.roa)}</div></div>
          <div><strong>Debt/Equity</strong><div>{ratios.debt_to_equity ?? "-"}</div></div>
          <div><strong>Current Ratio</strong><div>{ratios.current_ratio ?? "-"}</div></div>
          <div><strong>Gross Margin</strong><div>{fmtPct(ratios.gross_margin)}</div></div>
          <div><strong>Net Margin</strong><div>{fmtPct(ratios.net_margin)}</div></div>
          <div><strong>Revenue Growth YoY</strong><div>{fmtPct(ratios.revenue_growth_yoy)}</div></div>
        </div>
      </div>

      <div className="card">
        <h3>Price history</h3>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={history}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={40} />
            <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10 }} />
            <Tooltip />
            <Line type="monotone" dataKey="close" stroke="#2563eb" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <PredictionPanel ticker={ticker} />
    </div>
  );
}
