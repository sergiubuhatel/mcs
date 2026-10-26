import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { apiClient } from "../api/client";
import ForecastChart, { BandLevelSelect, forecastFromDocs } from "../components/ForecastChart";
import ForecastPanels from "../features/predictions/ForecastPanels";
import { filterByInterval } from "../utils/dateRanges";
import BackButton from "../layout/BackButton";
import { chartIntervals, getSettings } from "../features/settings/settings";

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

const TRADING_DAYS_PER_YEAR = 252;

// Annualized stdev of daily % change over the given window -- same formula
// the backend uses for the stored 1Y figure, just recomputed client-side
// over whatever range is currently selected on the chart.
function computeVolatility(rangeHistory) {
  const dailyReturns = rangeHistory
    .map((h) => h.percentage_change)
    .filter((v) => v !== null && v !== undefined)
    .map((v) => v / 100);
  if (dailyReturns.length < 2) return null;

  const mean = dailyReturns.reduce((sum, v) => sum + v, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (dailyReturns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}


export default function CompanyDetailPage() {
  const { ticker } = useParams();
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [range, setRange] = useState(() => getSettings().general.chart_range);
  const [forecastDocs, setForecastDocs] = useState(null); // stored {lstm, arima} docs
  const [showForecast, setShowForecast] = useState(true);
  const [bandLevel, setBandLevel] = useState(() => Number(getSettings().forecast.band_level) || 95);
  const forecast = useMemo(
    () => (forecastDocs ? forecastFromDocs(forecastDocs.lstm, forecastDocs.arima, bandLevel) : null),
    [forecastDocs, bandLevel]
  );

  useEffect(() => {
    setDetail(null);
    setError(null);
    apiClient
      .get(`/api/companies/${ticker}`)
      .then((res) => setDetail(res.data))
      .catch((err) => setError(err.response?.data?.error || err.message));
    // Stored LSTM / ARIMA forecasts, drawn after the history with each model's band.
    setForecastDocs(null);
    const optional = (url) => apiClient.get(url).then((r) => r.data).catch(() => null);
    Promise.all([optional(`/api/predictions/${ticker}`), optional(`/api/arima/${ticker}`)]).then(([lstm, arima]) =>
      setForecastDocs({ lstm, arima })
    );
  }, [ticker]);


  if (error)
    return (
      <div className="card error-text" style={{ position: "relative" }}>
        <div className="card-corner"><BackButton /></div>
        {error}
      </div>
    );
  if (!detail)
    return (
      <div className="card muted" style={{ position: "relative" }}>
        <div className="card-corner"><BackButton /></div>
        Loading...
      </div>
    );

  const { company, stats, history } = detail;
  const dayChangePct =
    stats.current_price != null && stats.previous_close
      ? ((stats.current_price - stats.previous_close) / stats.previous_close) * 100
      : null;

  return (
    <div>
      <div className="card" style={{ position: "relative" }}>
        <div className="card-corner"><BackButton /></div>
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
          <div><strong>Market Cap</strong><div>{fmtLarge(stats.market_cap != null ? stats.market_cap * 1e6 : null)}</div></div>
          <div><strong>Trailing P/E</strong><div>{fmtNum(stats.trailing_pe)}</div></div>
          <div><strong>Beta</strong><div>{fmtNum(stats.beta)}</div></div>
          <div><strong>ROE</strong><div>{fmtPct(stats.roe_ttm)}</div></div>
          <div><strong>ROA</strong><div>{fmtPct(stats.roa_ttm)}</div></div>
          <div><strong>Debt/Equity</strong><div>{fmtNum(stats.debt_to_equity_mrq)}</div></div>
          <div><strong>Current Ratio</strong><div>{fmtNum(stats.current_ratio_mrq)}</div></div>
          <div><strong>Quarterly Revenue Growth</strong><div>{fmtPct(stats.revenue_growth_yoy_q)}</div></div>
          <div><strong>Quarterly Earnings Growth</strong><div>{fmtPct(stats.earnings_growth_yoy_q)}</div></div>
        </div>
      </div>

      {(() => {
        const rangeHistory = filterByInterval(history, range);
        const periodChangePct =
          rangeHistory.length >= 2 && rangeHistory[0].close
            ? ((rangeHistory[rangeHistory.length - 1].close - rangeHistory[0].close) / rangeHistory[0].close) * 100
            : null;
        const periodVolatility = computeVolatility(rangeHistory);
        return (
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <h3 style={{ margin: 0 }}>Price history{forecast && showForecast ? " and forecast" : ""}</h3>
                {periodChangePct !== null && (
                  <span style={{ color: changeColor(periodChangePct), fontWeight: 600 }}>
                    {periodChangePct > 0 ? "+" : ""}{periodChangePct.toFixed(2)}% ({range})
                  </span>
                )}
                {periodVolatility !== null && (
                  <span className="muted">Volatility ({range}): <strong style={{ color: "var(--color-text-primary)" }}>{fmtPct(periodVolatility)}</strong></span>
                )}
              </div>
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                {forecast && (
                  <label className="muted" style={{ display: "flex", alignItems: "center", gap: 5, marginRight: 8, fontSize: "0.8rem" }} title="LSTM and ARIMA forecasts with each model's measured band">
                    <input type="checkbox" checked={showForecast} onChange={(e) => setShowForecast(e.target.checked)} /> Forecast
                  </label>
                )}
                {forecast && showForecast && (
                  <BandLevelSelect value={bandLevel} onChange={setBandLevel} />
                )}
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
            <ForecastChart
              history={rangeHistory.map((h) => ({ date: h.date, value: h.close }))}
              forecast={showForecast ? forecast : null}
              format={(v) => `$${Number(v).toFixed(2)}`}
              historyName="Close"
              height={300}
            />
            {forecast && showForecast && (
              <p className="muted" style={{ margin: "4px 0 0", fontSize: "0.8rem" }}>
                Dashed: stored LSTM and ARIMA forecasts, one point per trading day. Shaded: each model&apos;s {bandLevel}% band, measured at every step from where prices actually landed in its backtest (a full forecast from each held-out day). Retrain them below.
              </p>
            )}
          </div>
        );
      })()}

      <ForecastPanels ticker={ticker} />
    </div>
  );
}
