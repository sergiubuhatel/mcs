import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import { apiClient } from "../api/client";
import { filterByInterval } from "../utils/dateRanges";
import { useColumnConfig } from "../utils/useColumnConfig";
import ActionMenu from "../components/ActionMenu";
import ColumnPicker from "../components/ColumnPicker";
import ConfirmDeleteModal from "../components/ConfirmDeleteModal";
import ForecastChart, { BandLevelSelect, FORECAST_COLORS } from "../components/ForecastChart";
import Modal from "../components/Modal";
import Req from "../components/Req";
import { StatTiles } from "../components/PageParts";
import SignalBoard, { SignalBadge } from "../features/signals/SignalBoard";
import BackButton from "../layout/BackButton";
import { ClockIcon, CopyIcon, DatabaseIcon, EditIcon, GrowthIcon, LayersIcon, ListIcon, PieChartIcon, SaveIcon, StarIcon, TrendChartIcon, TrendDownIcon, TrendUpIcon } from "../layout/icons";
import { chartIntervals, getSettings } from "../features/settings/settings";
import { fmtDay, nextReportLabel, relativeDays } from "../features/earnings/FinancialResultsCard";

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
const signed = (pct) => (pct == null ? "–" : `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`);
// dividend_yield comes back from yfinance already as a plain percent number
// (e.g. 0.44 meaning 0.44%), unlike roe/roa/margins/growth (decimal
// fractions) -- so this doesn't multiply by 100 like fmtPct does.
function fmtRawPct(v) {
  return v === null || v === undefined ? "-" : `${Number(v).toFixed(2)}%`;
}

const TRADING_DAYS_PER_YEAR = 252;

// Annualized stdev of daily returns derived from the indexed performance
// series (value-to-value, since this series carries a cumulative index
// rather than a raw percentage_change field), over the given window.
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

// % change first -> last point of a window of the indexed series.
function windowChangePct(rangeSeries) {
  return rangeSeries.length >= 2 && rangeSeries[0].value
    ? ((rangeSeries[rangeSeries.length - 1].value - rangeSeries[0].value) / rangeSeries[0].value) * 100
    : null;
}

// Categorical palette for the allocation bars (one distinct color per holding,
// cycling if a portfolio ever has more holdings than colors).
const ALLOCATION_COLORS = [
  "#2563eb", "#f97316", "#16a34a", "#dc2626", "#9333ea",
  "#a16207", "#ec4899", "#6b7280", "#ca8a04", "#0ea5e9",
];

const SIGNAL_RANK = { Strong: 3, Mixed: 2, Weak: 1, Avoid: 0 };

// Portfolio-level signal for the tile: the most common holding signal
// (ties go to the better one), with how many holdings carry it.
function overallSignal(board) {
  const s = board?.summary;
  const n = board?.rows?.length || 0;
  if (!s || !n || s.missing_forecasts === n) return null;
  const [signal, count] = Object.keys(SIGNAL_RANK)
    .map((k) => [k, s[k] || 0])
    .sort((a, b) => b[1] - a[1] || SIGNAL_RANK[b[0]] - SIGNAL_RANK[a[0]])[0];
  const aligned = s.agree === n ? "models aligned" : `${s.agree} of ${n} agree`;
  return { signal, sub: `${count} of ${n} · ${aligned}`, title: `${count} of ${n} holdings are ${signal}; LSTM and ARIMA agree on ${s.agree} of ${n}` };
}

const HOLDINGS_COLUMNS = [
  {
    key: "ticker",
    label: "Ticker",
    locked: true,
    render: (h) => <Link to={`/companies/${h.ticker}`} onClick={(e) => e.stopPropagation()}>{h.ticker}</Link>,
  },
  { key: "name", label: "Company", render: (h) => h.name || "-" },
  // Earnings release dates; the hover says how far away.
  { key: "last_report_date", label: "Last Results", render: (h) => <span title={relativeDays(h.last_report_date)}>{fmtDay(h.last_report_date)}</span> },
  {
    key: "next_report_date",
    label: "Next Results",
    render: (h) => (
      <span title={h.next_report_confirmed === false ? `${relativeDays(h.next_report_date)}, estimated by Yahoo` : relativeDays(h.next_report_date)}>
        {nextReportLabel(h.next_report_date, h.next_report_confirmed)}
      </span>
    ),
  },
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
  { key: "free_cash_flow", label: "Free Cash Flow", render: (h) => fmtLarge(h.free_cash_flow) },
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
];

const apiError = (err) => err.response?.data?.error || err.message;

export default function PortfolioDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [portfolio, setPortfolio] = useState(null);
  const [series, setSeries] = useState(null);
  const [error, setError] = useState(null);
  const [range, setRange] = useState(() => getSettings().general.chart_range);
  const [sortBy, setSortBy] = useState("weight");
  const [sortDir, setSortDir] = useState("desc");
  const [board, setBoard] = useState(null);
  const [forecast, setForecast] = useState(null); // growth factors from /forecast, or {error}
  const [showForecast, setShowForecast] = useState(true);
  const [bandLevel, setBandLevel] = useState(() => Number(getSettings().forecast.band_level) || 95);
  const [renaming, setRenaming] = useState(null); // name being edited, or null
  const [confirmDelete, setConfirmDelete] = useState(false);
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
    setBoard(null);
    Promise.all([
      apiClient.get(`/api/portfolios/${id}`),
      apiClient.get(`/api/portfolios/${id}/performance`, { params: { days: 3650 } }), // up to ~10 years
    ])
      .then(([detailRes, perfRes]) => {
        setPortfolio(detailRes.data);
        setSeries(perfRes.data.series);
      })
      .catch((err) => setError(apiError(err)));
  }, [id]);

  // Where the portfolio is heading: reloaded whenever the signal board
  // changes (e.g. after its Forecast all run trained new forecasts).
  useEffect(() => {
    apiClient
      .get(`/api/portfolios/${id}/forecast`, { params: { level: bandLevel } })
      .then((r) => setForecast(r.data))
      .catch((err) => setForecast({ error: apiError(err) }));
  }, [id, board, bandLevel]);

  const rename = (e) => {
    e.preventDefault();
    const name = renaming.trim();
    if (!name) return;
    apiClient
      .put(`/api/portfolios/${id}`, { name })
      .then((r) => {
        setPortfolio((p) => ({ ...p, name: r.data.name ?? name }));
        setRenaming(null);
        toast.success("Portfolio renamed");
      })
      .catch((err) => toast.error(apiError(err)));
  };

  const duplicate = () =>
    apiClient
      .post("/api/portfolios", {
        name: `${portfolio.name} (copy)`,
        holdings: portfolio.holdings.map((h) => ({ ticker: h.ticker, weight: h.weight })),
        method: portfolio.method,
        notes: portfolio.notes,
      })
      .then((r) => {
        toast.success("Portfolio duplicated");
        navigate(`/portfolios/${r.data._key}`);
      })
      .catch((err) => toast.error(apiError(err)));

  const remove = () =>
    apiClient
      .delete(`/api/portfolios/${id}`)
      .then(() => {
        toast.success(`Deleted "${portfolio.name}"`);
        navigate("/portfolio", { replace: true });
      })
      .catch((err) => toast.error(apiError(err)));

  if (error)
    return (
      <div className="card error-text" style={{ position: "relative" }}>
        <div className="card-corner"><BackButton /></div>
        {error}
      </div>
    );
  if (!portfolio || !series)
    return (
      <div className="card muted" style={{ position: "relative" }}>
        <div className="card-corner"><BackButton /></div>
        Loading...
      </div>
    );

  const rangeSeries = filterByInterval(series, range);
  // Forecast growth factors (1 = today) -> index values from the last point.
  const lastIndex = series?.length ? series[series.length - 1].value : null;
  const forecastIndex =
    forecast && !forecast.error && lastIndex != null
      ? {
          dates: forecast.dates,
          level: forecast.level,
          lstm: forecast.lstm.map((g) => g * lastIndex),
          arima: forecast.arima.map((g) => g * lastIndex),
          lstmBand: forecast.lstm_lower && {
            low: forecast.lstm_lower.map((g) => g * lastIndex),
            high: forecast.lstm_upper.map((g) => g * lastIndex),
          },
          arimaBand: { low: forecast.lower.map((g) => g * lastIndex), high: forecast.upper.map((g) => g * lastIndex) },
        }
      : null;
  const pctOf = (g) => `${g >= 1 ? "+" : ""}${((g - 1) * 100).toFixed(1)}%`;
  const missingForecasts = forecast && !forecast.error ? [...new Set([...forecast.missing.lstm, ...forecast.missing.arima])] : [];
  const periodChangePct = windowChangePct(rangeSeries);
  const periodVolatility = computeVolatilityFromSeries(rangeSeries);
  // Tiles always use the past year (same window as the 1Y chart / My Portfolios).
  const yearSeries = filterByInterval(series, "1Y");
  const yearChangePct = windowChangePct(yearSeries);
  const yearVolatility = computeVolatilityFromSeries(yearSeries);
  // Latest close vs the previous one (the same index as the chart).
  const prevPoint = series.length > 1 ? series[series.length - 2] : null;
  const dayChangePct = prevPoint && prevPoint.value ? (series[series.length - 1].value / prevPoint.value - 1) * 100 : null;
  const allocation = portfolio.holdings
    .map((h) => ({ ticker: h.ticker, name: h.name, weightPct: h.weight * 100 }))
    .sort((a, b) => b.weightPct - a.weightPct);
  const maxWeight = Math.max(...allocation.map((a) => a.weightPct), 1);
  // Same color per holding in the holdings grid and the allocation bars.
  const colorOf = Object.fromEntries(allocation.map((a, i) => [a.ticker, ALLOCATION_COLORS[i % ALLOCATION_COLORS.length]]));
  const signal = overallSignal(board);
  const built = portfolio.method === "rl" ? "RL-optimized portfolio" : portfolio.method === "imported"
        ? "Imported from a statement"
        : portfolio.method === "combined"
        ? `Portfolio of portfolios: ${(portfolio.sleeves || []).map((s) => `${+s.allocation.toFixed(2)}% ${s.name}`).join(" + ")}`
        : "Hand-built portfolio";
  const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : null);
  const created = fmtDay(portfolio.created_at);
  const lastUpdated = fmtDay(portfolio.updated_at || portfolio.created_at);
  const asOf = series.length ? series[series.length - 1].date : null; // latest stored close

  const tiles = [
    {
      icon: dayChangePct != null && dayChangePct < 0 ? TrendDownIcon : TrendUpIcon,
      color: dayChangePct != null && dayChangePct < 0 ? "#dc2626" : "#16a34a",
      label: "Change (1D)",
      value: <span style={{ color: changeColor(dayChangePct) }}>{signed(dayChangePct)}</span>,
      sub: prevPoint ? `${asOf} vs ${prevPoint.date}` : "no previous close",
      title: "Change of the portfolio index from the previous close to the latest close.",
    },
    {
      icon: GrowthIcon,
      color: "#16a34a",
      label: "1Y return",
      value: <span style={{ color: changeColor(yearChangePct) }}>{signed(yearChangePct)}</span>,
      sub: "historical backtest",
      title: "Change of the portfolio index over the past year (same as the 1Y chart).",
    },
    {
      icon: DatabaseIcon,
      color: "#6366f1",
      label: "Annual volatility (1Y)",
      value: fmtPct(yearVolatility),
      sub: `std. dev. · at build ${fmtPct(portfolio.expected_volatility)}`,
      title: "Annualized standard deviation of the portfolio's daily returns over the past year.",
    },
    {
      icon: StarIcon,
      color: "#06b6d4",
      label: "Expected return (ann.)",
      value: <span style={{ color: changeColor(portfolio.expected_return) }}>{fmtPct(portfolio.expected_return)}</span>,
      sub: "estimate at build",
      title: "Annualized mean return of the holdings' history at the time the portfolio was built (not a forecast).",
    },
    {
      icon: LayersIcon,
      color: "#8b5cf6",
      label: "Holdings",
      value: portfolio.holdings.length,
      sub: `largest ${allocation[0]?.ticker ?? "–"} · ${allocation[0] ? allocation[0].weightPct.toFixed(1) : "–"}%`,
      title: "Companies in the portfolio.",
    },
    {
      icon: TrendChartIcon,
      color: "#f59e0b",
      label: "Latest signal",
      value: signal ? <SignalBadge signal={signal.signal} /> : <span className="muted" style={{ fontSize: "0.95rem" }}>{board ? "Not rated" : "…"}</span>,
      sub: signal ? signal.sub : board ? "run forecasts in the signal board below" : "loading signals",
      title: "Most common signal among the holdings, from the signal board below (LSTM + ARIMA + RL + fundamentals).",
    },
  ];

  return (
    <div>
      <div className="card header-card">
        <header className="page-header">
          <div className="icon-badge page-header-icon" style={{ background: "#ef444426", color: "#ef4444" }}>
            <PieChartIcon width={28} height={28} />
          </div>
          <div style={{ minWidth: 0 }}>
            <h2 className="clamp-2 portfolio-title" title={portfolio.name}>{portfolio.name}</h2>
            <p className="muted clamp-2" style={{ margin: 0, fontSize: "0.85rem" }} title={portfolio.notes || undefined}>
              {built}
              {portfolio.notes ? ` · ${portfolio.notes}` : ""}
              {created ? ` · created ${created}` : ""}
              {portfolio.sharpe_ratio != null ? ` · Sharpe ${portfolio.sharpe_ratio}` : ""}
            </p>
          </div>
          <div className="page-header-actions">
            {lastUpdated && (
              <span className="last-updated" title="Created, or last renamed">
                <ClockIcon width={16} height={16} />
                <span>
                  <span className="muted">Last updated</span>
                  <br />
                  {lastUpdated}
                </span>
              </span>
            )}
            <button
              className="btn"
              onClick={() => (portfolio.sleeves ? navigate(`/combine-portfolios?id=${portfolio._key}`) : setRenaming(portfolio.name))}
              title={portfolio.sleeves ? "Change its portfolios, their shares and the name" : "Edit this portfolio's name"}
            >
              <EditIcon width={15} height={15} /> Edit Portfolio
            </button>
            <button className="btn secondary" onClick={duplicate} title="Save a copy of this portfolio and open it">
              <CopyIcon width={15} height={15} /> Duplicate
            </button>
            <ActionMenu onDelete={() => setConfirmDelete(true)} />
            <BackButton />
          </div>
        </header>
      </div>

      <StatTiles tiles={tiles} />

      <div className="card">
        <div className="card-header" style={{ justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className="icon-badge" style={{ background: "#3b82f622", color: "#3b82f6" }}>
              <ListIcon width={18} height={18} />
            </div>
            <h3 style={{ margin: 0 }}>Selected holdings performance</h3>
          </div>
          <div className="toolbar">
            {asOf && <span className="muted">as of {asOf}</span>}
            <ColumnPicker columns={columns} hidden={hidden} onToggle={toggleVisible} onMove={moveColumn} onReset={reset} />
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
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
                      <td
                        key={c.key}
                        className={c.className}
                        style={c.key === "ticker" || c.key === "name" ? { textAlign: "left" } : c.key === "weight" ? { color: colorOf[h.ticker] } : undefined}
                      >
                        {c.render(h)}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>


      <div className="card">
        <div className="card-header" style={{ flexWrap: "wrap", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div className="icon-badge" style={{ background: "#3b82f622", color: "#3b82f6" }}>
              <TrendChartIcon width={18} height={18} />
            </div>
            <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
              Portfolio performance
              <span
                className="help-dot"
                role="img"
                title="Indexed to 100 at the start of the available price history, applying the portfolio's fixed weights to each day's actual returns."
                aria-label="Indexed to 100 at the start of the available price history, applying the portfolio's fixed weights to each day's actual returns."
              >?</span>
            </h3>
            {periodChangePct !== null && (
              <span style={{ color: changeColor(periodChangePct), fontWeight: 600 }}>{signed(periodChangePct)} ({range})</span>
            )}
            {periodVolatility !== null && (
              <span className="muted">Volatility ({range}): <strong style={{ color: "var(--color-text-primary)" }}>{fmtPct(periodVolatility)}</strong></span>
            )}
            {portfolio.sharpe_ratio != null && (
              <span className="muted">| Sharpe: <strong style={{ color: "var(--color-text-primary)" }}>{portfolio.sharpe_ratio}</strong></span>
            )}
            {portfolio.expected_return != null && (
              <span className="muted">| Expected annual return: <strong style={{ color: "var(--color-text-primary)" }}>{fmtPct(portfolio.expected_return)}</strong></span>
            )}
          </div>
          <div style={{ display: "flex", gap: 4, alignItems: "center", marginLeft: "auto" }}>
            {forecastIndex && (
              <label className="muted" style={{ display: "flex", alignItems: "center", gap: 5, marginRight: 8, fontSize: "0.8rem" }} title="Where the portfolio is heading: its holdings' LSTM and ARIMA forecasts with a measured band">
                <input type="checkbox" checked={showForecast} onChange={(e) => setShowForecast(e.target.checked)} /> Forecast
              </label>
            )}
            {forecastIndex && showForecast && <BandLevelSelect value={bandLevel} onChange={setBandLevel} />}
            {chartIntervals("general").map((iv) => (
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
          <ForecastChart
            history={rangeSeries}
            forecast={showForecast ? forecastIndex : null}
            format={(v) => Number(v).toFixed(1)}
            historyName="Index value"
            area
            height={280}
          />
        )}
        {showForecast && forecast && !forecast.error && (
          <div className="forecast-strip">
            <span className="muted">Forecast from {forecast.data_end ? `the ${forecast.data_end} close` : "the last close"}:</span>
            {Object.entries(forecast.horizons).map(([h, v]) => (
              <span key={h} className="forecast-chip" title={`${h} (${v.date}): LSTM ${forecast.level}% band ${pctOf(v.lstm_lower)} to ${pctOf(v.lstm_upper)}; ARIMA ${forecast.level}% band ${pctOf(v.lower)} to ${pctOf(v.upper)}`}>
                <strong>{h}</strong>
                <span style={{ color: FORECAST_COLORS.lstm }}>LSTM {pctOf(v.lstm)} <span className="muted">({pctOf(v.lstm_lower)} … {pctOf(v.lstm_upper)})</span></span>
                <span style={{ color: FORECAST_COLORS.arima }}>ARIMA {pctOf(v.arima)} <span className="muted">({pctOf(v.lower)} … {pctOf(v.upper)})</span></span>

              </span>
            ))}
            <span
              className="help-dot"
              role="img"
              title="Each holding's stored LSTM and ARIMA forecast (one point per trading day), combined with the portfolio weights. Each model's band (in brackets, at the chosen confidence level) is measured, not assumed: every stock's model made a full forecast from each of its ~500 held-out days, and at each step a 95% band covers 95% of where prices actually landed. The stocks' bands are combined using how the holdings moved together over the past year (correlation), so the portfolio band is narrower than the stocks' bands added up."
              aria-label="How the portfolio forecast is computed"
            >?</span>
          </div>
        )}
        {missingForecasts.length > 0 && (
          <p className="muted" style={{ margin: "4px 0 0", fontSize: "0.8rem" }}>
            No forecast yet for {missingForecasts.join(", ")} — counted as flat, with a band from their past-year volatility. Run Forecast all in the signal board below.
          </p>
        )}
        {forecast?.error && (
          <p className="muted" style={{ margin: "4px 0 0", fontSize: "0.8rem" }}>{forecast.error}</p>
        )}
      </div>

      <div className="card">
        <div className="card-header" style={{ alignItems: "flex-start", marginBottom: 8 }}>
          <div className="icon-badge" style={{ background: "#3b82f622", color: "#3b82f6" }}>
            <PieChartIcon width={18} height={18} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3 style={{ margin: 0 }}>Portfolio allocation</h3>
            <p className="muted" style={{ margin: 0 }}>
              Share of the portfolio invested in each holding{portfolio.method === "rl" ? ", as allocated by the reinforcement learning model" : ""}.
            </p>
          </div>
          <span className="muted">{allocation.length} holding{allocation.length === 1 ? "" : "s"}</span>
        </div>
        <div className="alloc-rows">
          <div className="alloc-row alloc-head">
            <span>Ticker</span>
            <span>Company</span>
            <span />
            <span className="alloc-pct">Weight</span>
          </div>
          {allocation.map((a, i) => (
            <Link key={a.ticker} to={`/companies/${a.ticker}`} className="alloc-row" title={`${a.name || a.ticker}: ${a.weightPct.toFixed(2)}%`}>
              <span className="alloc-ticker">{a.ticker}</span>
              <span className="alloc-name">{a.name || ""}</span>
              <span className="alloc-track">
                <span style={{ width: `${(a.weightPct / maxWeight) * 100}%`, background: ALLOCATION_COLORS[i % ALLOCATION_COLORS.length] }} />
              </span>
              <span className="alloc-pct">{a.weightPct.toFixed(2)}%</span>
            </Link>
          ))}
        </div>
      </div>

      <SignalBoard portfolioId={id} onBoard={setBoard} />

      <Modal
        isOpen={renaming !== null}
        onClose={() => setRenaming(null)}
        title="Edit portfolio"
        headerActions={
          <button className="close-btn" style={{ position: "static" }} type="submit" form="rename-portfolio" title="Save" aria-label="Save">
            <SaveIcon width={18} height={18} />
          </button>
        }
      >
        <form id="rename-portfolio" onSubmit={rename}>
          <label>Name<Req /></label>
          <input value={renaming ?? ""} onChange={(e) => setRenaming(e.target.value)} autoFocus />
        </form>
      </Modal>
      <ConfirmDeleteModal
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        itemName={portfolio.name}
        title="Delete portfolio"
      />
    </div>
  );
}
