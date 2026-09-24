import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiClient } from "../api/client";
import { CloseIcon } from "../layout/icons";
import { INTERVALS, filterByInterval } from "../utils/dateRanges";
import { tooltipProps } from "../utils/chartTheme";
import { useColumnConfig } from "../utils/useColumnConfig";
import ColumnPicker from "../components/ColumnPicker";

function fmtPct(v) {
  return v === null || v === undefined ? "-" : `${(Number(v) * 100).toFixed(2)}%`;
}
function fmtNum(v) {
  return v === null || v === undefined ? "-" : Number(v).toFixed(2);
}
function fmtLarge(v) {
  if (v === null || v === undefined) return "-";
  const n = Number(v);
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n.toFixed(0)}`;
}
function changeColor(value) {
  if (value === null || value === undefined || value === 0) return "var(--color-text-primary)";
  return value > 0 ? "#16a34a" : "#dc2626";
}
// dividend_yield comes back from yfinance already as a plain percent number
// (e.g. 0.44 meaning 0.44%), unlike roe/roa/margins/growth (decimal
// fractions) -- so this doesn't multiply by 100 like fmtPct does.
function fmtRawPct(v) {
  return v === null || v === undefined ? "-" : `${Number(v).toFixed(2)}%`;
}

const TRADING_DAYS_PER_YEAR = 252;

// Annualized stdev of daily returns derived from the indexed performance
// series (value-to-value, since this series carries a cumulative index
// rather than a raw percentage_change field), over whatever range is
// currently selected on the chart.
function computeVolatilityFromSeries(rangeSeries) {
  const dailyReturns = [];
  for (let i = 1; i < rangeSeries.length; i++) {
    const prev = rangeSeries[i - 1].value;
    const curr = rangeSeries[i].value;
    if (prev) dailyReturns.push(curr / prev - 1);
  }
  if (dailyReturns.length < 2) return null;

  const mean = dailyReturns.reduce((sum, v) => sum + v, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (dailyReturns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

const HOLDINGS_COLUMNS = [
  {
    key: "ticker",
    label: "Ticker",
    locked: true,
    render: (h) => <Link to={`/companies/${h.ticker}`} onClick={(e) => e.stopPropagation()}>{h.ticker}</Link>,
  },
  { key: "name", label: "Company", render: (h) => h.name || "-" },
  {
    key: "day_change",
    label: "Change (1D)",
    render: (h) => (
      <span style={{ color: changeColor(h.day_change), fontWeight: 600 }}>
        {h.day_change != null && h.day_change > 0 ? "+" : ""}
        {fmtPct(h.day_change)}
      </span>
    ),
  },
  {
    key: "stock_growth_1y",
    label: "Change (1Y)",
    render: (h) => (
      <span style={{ color: changeColor(h.stock_growth_1y), fontWeight: 600 }}>
        {h.stock_growth_1y != null && h.stock_growth_1y > 0 ? "+" : ""}
        {fmtPct(h.stock_growth_1y)}
      </span>
    ),
  },
  { key: "volatility", label: "Volatility (1Y)", render: (h) => fmtPct(h.volatility) },
  { key: "market_cap", label: "Market Cap", render: (h) => fmtLarge(h.market_cap != null ? h.market_cap * 1e6 : null) },
  { key: "trailing_pe", label: "Trailing P/E", render: (h) => fmtNum(h.trailing_pe) },
  { key: "forward_pe", label: "Forward P/E", render: (h) => fmtNum(h.forward_pe) },
  { key: "revenue_growth_yoy_q", label: "Revenue Growth", render: (h) => fmtPct(h.revenue_growth_yoy_q) },
  { key: "earnings_growth_yoy_q", label: "Earnings Growth", render: (h) => fmtPct(h.earnings_growth_yoy_q) },
  { key: "weight", label: "Weight", className: "weight", render: (h) => `${(h.weight * 100).toFixed(2)}%` },
  // Present on the screener's filter form but not shown here by default --
  // available via the Columns picker instead of crowding the default view.
  { key: "peg_ratio", label: "PEG Ratio", hiddenByDefault: true, render: (h) => fmtNum(h.peg_ratio) },
  { key: "gross_margin", label: "Gross Margin", hiddenByDefault: true, render: (h) => fmtPct(h.gross_margin) },
  { key: "operating_margin", label: "Op Margin", hiddenByDefault: true, render: (h) => fmtPct(h.operating_margin) },
  { key: "net_margin", label: "Net Margin", hiddenByDefault: true, render: (h) => fmtPct(h.net_margin) },
  { key: "current_ratio", label: "Current Ratio", hiddenByDefault: true, render: (h) => fmtNum(h.current_ratio) },
  { key: "ev_to_ebitda", label: "EV/EBITDA", hiddenByDefault: true, render: (h) => fmtNum(h.ev_to_ebitda) },
  { key: "dividend_yield", label: "Dividend Yield", hiddenByDefault: true, render: (h) => fmtRawPct(h.dividend_yield) },
  { key: "free_cash_flow", label: "Free Cash Flow", render: (h) => fmtLarge(h.free_cash_flow) },
];

export default function PortfolioDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [portfolio, setPortfolio] = useState(null);
  const [series, setSeries] = useState(null);
  const [error, setError] = useState(null);
  const [range, setRange] = useState("1Y");
  const [sortBy, setSortBy] = useState("weight");
  const [sortDir, setSortDir] = useState("desc");
  const { columns, visibleColumns, hidden, toggleVisible, moveColumn, reset } = useColumnConfig("portfolioHoldings", HOLDINGS_COLUMNS);

  const onSortClick = (key) => {
    if (key === sortBy) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortBy(key);
      setSortDir("desc");
    }
  };

  useEffect(() => {
    setPortfolio(null);
    setSeries(null);
    setError(null);
    Promise.all([
      apiClient.get(`/api/portfolios/${id}`),
      apiClient.get(`/api/portfolios/${id}/performance`, { params: { days: 3650 } }), // up to ~10 years
    ])
      .then(([detailRes, perfRes]) => {
        setPortfolio(detailRes.data);
        setSeries(perfRes.data.series);
      })
      .catch((err) => setError(err.response?.data?.error || err.message));
  }, [id]);

  const CloseButton = (
    <button className="close-btn" onClick={() => navigate(-1)} title="Back" aria-label="Back">
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
  if (!portfolio || !series)
    return (
      <div className="card muted" style={{ position: "relative" }}>
        {CloseButton}
        Loading...
      </div>
    );

  const rangeSeries = filterByInterval(series, range);
  const periodChangePct =
    rangeSeries.length >= 2 && rangeSeries[0].value
      ? ((rangeSeries[rangeSeries.length - 1].value - rangeSeries[0].value) / rangeSeries[0].value) * 100
      : null;
  const periodVolatility = computeVolatilityFromSeries(rangeSeries);

  return (
    <div>
      <div className="card" style={{ position: "relative" }}>
        {CloseButton}
        <h2 style={{ paddingRight: 48 }}>{portfolio.name}</h2>
        <p className="muted">
          Expected annual return: <strong style={{ color: changeColor(portfolio.expected_return) }}>{fmtPct(portfolio.expected_return)}</strong>
          {" · "}Volatility: <strong>{fmtPct(portfolio.expected_volatility)}</strong>
          {" · "}Sharpe: <strong>{portfolio.sharpe_ratio ?? "-"}</strong>
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <ColumnPicker columns={columns} hidden={hidden} onToggle={toggleVisible} onMove={moveColumn} onReset={reset} />
        </div>
        <table className="holdings-table">
          <thead>
            <tr>
              {visibleColumns.map((c) => (
                <th key={c.key} className={sortBy === c.key ? "sorted" : ""} onClick={() => onSortClick(c.key)} style={{ cursor: "pointer" }}>
                  {c.label}
                  <span style={{ visibility: sortBy === c.key ? "visible" : "hidden" }}>
                    {" "}{sortDir === "desc" ? "↓" : "↑"}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {portfolio.holdings
              .slice()
              .sort((a, b) => {
                const va = a[sortBy];
                const vb = b[sortBy];
                if (va == null && vb == null) return 0;
                if (va == null) return 1;
                if (vb == null) return -1;
                const cmp = typeof va === "string" ? va.localeCompare(vb) : va - vb;
                return sortDir === "desc" ? -cmp : cmp;
              })
              .map((h) => (
                <tr key={h.ticker} onClick={() => navigate(`/companies/${h.ticker}`)} style={{ cursor: "pointer" }}>
                  {visibleColumns.map((c) => (
                    <td key={c.key} className={c.className} style={c.key === "ticker" || c.key === "name" ? { textAlign: "left" } : undefined}>
                      {c.render(h)}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <h3 style={{ margin: 0 }}>Portfolio performance</h3>
            {periodChangePct !== null && (
              <span style={{ color: changeColor(periodChangePct), fontWeight: 600 }}>
                {periodChangePct > 0 ? "+" : ""}{periodChangePct.toFixed(2)}% ({range})
              </span>
            )}
            {periodVolatility !== null && (
              <span className="muted">Volatility ({range}): <strong style={{ color: "var(--color-text-primary)" }}>{fmtPct(periodVolatility)}</strong></span>
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
        {rangeSeries.length === 0 ? (
          <p className="muted">Not enough price history to chart this portfolio yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={rangeSeries}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={40} />
              <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10 }} />
              <Tooltip {...tooltipProps} formatter={(value) => [Number(value).toFixed(2), "Index value"]} />
              <Line type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
        <p className="muted">Indexed to 100 at the start of the available price history, applying the portfolio's fixed weights to each day's actual returns.</p>
      </div>
    </div>
  );
}
