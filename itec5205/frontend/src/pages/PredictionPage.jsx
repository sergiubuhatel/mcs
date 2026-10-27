import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import ForecastChart, { BandLevelSelect, forecastFromDocs } from "../components/ForecastChart";
import { apiClient } from "../api/client";
import { PageHeader, QuickTipsBar } from "../components/PageParts";
import ForecastPanels from "../features/predictions/ForecastPanels";
import {
  BarChartIcon,
  ClockIcon,
  LayersIcon,
  LightbulbIcon,
  SearchIcon,
  TrendChartIcon,
} from "../layout/icons";
import { ALL_RESULTS } from "../features/companies/companiesSaga";
import RangePicker from "../components/RangePicker";
import { filterByInterval, rangeReachesEnd } from "../utils/dateRanges";
import { getSettings, tickerList } from "../features/settings/settings";

// Trading days per horizon -- matches backend services/horizons.py (1-4M)
// plus the short 1-day / 1-week points shown in the predicted-prices table.
const SIGNAL_HORIZONS = [
  { key: "1M", name: "1 month", days: 21 },
  { key: "2M", name: "2 months", days: 42 },
  { key: "3M", name: "3 months", days: 63 },
  { key: "4M", name: "4 months", days: 84 },
];
const TABLE_HORIZONS = [{ key: "1D", name: "1 day", days: 1 }, { key: "1W", name: "1 week", days: 5 }, ...SIGNAL_HORIZONS];
// Same dead band as the signal board (signal_service.DIRECTION_DEADBAND_PCT).
const DEADBAND_PCT = 0.05;
const COLORS = { history: "#2563eb", lstm: "#16a34a", arima: "#a855f7" };

const money = (v) => (v == null ? "–" : `$${Number(v).toFixed(2)}`);
// Changes that round to 0.00% read as unchanged: no sign, neutral color.
const roundsToZero = (v, digits = 2) => Math.abs(v) < 0.5 * 10 ** -digits;
const pct = (v, digits = 2) => (v == null ? "–" : roundsToZero(v, digits) ? `${(0).toFixed(digits)}%` : `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`);
const tone = (v) => (v == null || roundsToZero(v) ? undefined : v > 0 ? "#16a34a" : "#dc2626");
const fmtWhen = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "–");
const apiError = (err) => err.response?.data?.error || err.message;

function direction(change) {
  if (change == null) return null;
  if (change > DEADBAND_PCT) return "up";
  if (change < -DEADBAND_PCT) return "down";
  return "flat";
}

// Bullish = both models up at the horizon; Bearish = both down; one model
// only = that model's call; anything else = Mixed / Neutral.
function signalFor(lstmChange, arimaChange) {
  const l = direction(lstmChange);
  const a = direction(arimaChange);
  if (!l && !a) return null;
  if (l && a) {
    if (l === "up" && a === "up") return { label: "Bullish", tone: "good", note: "both models up" };
    if (l === "down" && a === "down") return { label: "Bearish", tone: "bad", note: "both models down" };
    if (l === "flat" && a === "flat") return { label: "Neutral", tone: "info", note: "both models flat" };
    return { label: "Mixed", tone: "warn", note: "the models disagree" };
  }
  const only = l ? "LSTM" : "ARIMA";
  const d = l || a;
  return { label: d === "up" ? "Bullish" : d === "down" ? "Bearish" : "Neutral", tone: d === "up" ? "good" : d === "down" ? "bad" : "info", note: `${only} only` };
}

const normalCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
function erf(x) {
  // Abramowitz-Stegun 7.1.26 (|error| < 1.5e-7).
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

// Forecast point `days` steps ahead and its change vs. the model's last close.
function pointAt(doc, days) {
  const p = doc?.forecast?.[days - 1];
  if (!p || !doc.last_actual_close) return null;
  return { ...p, change: (p.predicted_close / doc.last_actual_close - 1) * 100 };
}

// ARIMA's probability that the close at the horizon ends above the last
// close, from its 95% interval (half-width = 1.96 standard errors).
function probUp(arima, days) {
  const p = pointAt(arima, days);
  if (!p || p.lower_95 == null) return null;
  const se = (p.upper_95 - p.lower_95) / (2 * 1.96);
  return se > 0 ? normalCdf((p.predicted_close - arima.last_actual_close) / se) : null;
}

function horizonChange(row, model, key) {
  return row[model]?.horizons?.[key]?.change_pct ?? null;
}

function CardTitle({ icon: Icon, color = "#3b82f6", title, subtitle, action }) {
  return (
    <div className="card-header" style={{ flexWrap: "wrap" }}>
      <div className="icon-badge" style={{ background: `${color}22`, color }}>
        <Icon width={18} height={18} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        {subtitle && <p className="muted" style={{ margin: 0 }}>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function useTickerData(ticker) {
  const [state, setState] = useState({ loading: false, company: null, lstm: null, arima: null, error: null });
  const load = useCallback(() => {
    if (!ticker) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    const optional = (url) => apiClient.get(url).then((r) => r.data).catch((e) => (e.response?.status === 404 ? null : Promise.reject(e)));
    Promise.all([apiClient.get(`/api/companies/${ticker}`).then((r) => r.data), optional(`/api/predictions/${ticker}`), optional(`/api/arima/${ticker}`)])
      .then(([company, lstm, arima]) => setState({ loading: false, company, lstm, arima, error: null }))
      .catch((err) => setState({ loading: false, company: null, lstm: null, arima: null, error: apiError(err) }));
  }, [ticker]);
  useEffect(load, [load]);
  return { ...state, reload: load };
}

function PriceForecastCard({ ticker, company, lstm, arima, range, setRange, bandLevel, setBandLevel }) {
  const history = useMemo(
    () => filterByInterval((company?.history || []).map((h) => ({ date: h.date, value: h.close })), range),
    [company, range]
  );
  const forecast = useMemo(() => forecastFromDocs(lstm, arima, bandLevel), [lstm, arima, bandLevel]);

  return (
    <div className="card" style={{ minWidth: 0 }}>
      <CardTitle
        icon={TrendChartIcon}
        title="Price history and forecast"
        subtitle={`Daily closes and both models' daily forecasts for ${ticker}; each shaded band covers ${bandLevel}% of where prices landed in that model's backtest at the same step`}
        action={
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {forecast && <BandLevelSelect value={bandLevel} onChange={setBandLevel} />}
            <RangePicker section="forecast" value={range} onChange={setRange} />
          </div>
        }
      />
      {history.length === 0 ? (
        <p className="muted">No price history stored for {ticker}.</p>
      ) : (
        <ForecastChart history={history} forecast={rangeReachesEnd(company?.history || [], range) ? forecast : null} format={money} historyName="Price" height={300} />
      )}
    </div>
  );
}

function PredictedPrices({ lstm, arima }) {
  return (
    <div className="card" style={{ minWidth: 0 }}>
      <CardTitle icon={BarChartIcon} color="#8b5cf6" title="Predicted prices" subtitle="Forecast close and change vs. the last close" />
      <table>
        <thead>
          <tr>
            <th>Horizon</th>
            <th style={{ color: COLORS.lstm }}>LSTM</th>
            <th style={{ color: COLORS.arima }}>ARIMA</th>
          </tr>
        </thead>
        <tbody>
          {TABLE_HORIZONS.map((h) => {
            const l = pointAt(lstm, h.days);
            const a = pointAt(arima, h.days);
            return (
              <tr key={h.key}>
                <td style={{ textAlign: "left" }}>{h.name}</td>
                {[l, a].map((p, i) => (
                  <td key={i}>
                    {p ? (
                      <>
                        <strong style={{ color: tone(p.change) }}>{money(p.predicted_close)}</strong>
                        <div style={{ color: tone(p.change), fontSize: "0.75rem" }}>{pct(p.change)}</div>
                      </>
                    ) : (
                      <span className="muted">–</span>
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ModelComparison({ lstm, arima }) {
  const better = (a, b) => (a == null || b == null ? null : a < b ? "lstm" : b < a ? "arima" : null);
  const rmseWin = better(lstm?.test_rmse, arima?.test_rmse);
  const maeWin = better(lstm?.test_mae, arima?.test_mae);
  const rows = [
    { label: "Test RMSE", l: lstm?.test_rmse != null ? money(lstm.test_rmse) : "–", a: arima?.test_rmse != null ? money(arima.test_rmse) : "–", win: rmseWin },
    { label: "Test MAE", l: lstm?.test_mae != null ? money(lstm.test_mae) : "–", a: arima?.test_mae != null ? money(arima.test_mae) : "–", win: maeWin },
    { label: "Training days", l: lstm?.history_days?.toLocaleString() ?? "–", a: arima?.history_days?.toLocaleString() ?? "–" },
    { label: "Test days", l: lstm?.test_days ?? "–", a: arima?.test_days ?? "–" },
    {
      label: "Model",
      l: lstm ? `best epoch ${lstm.best_epoch ?? "–"} / ${lstm.epochs_run ?? "–"}` : "–",
      a: arima?.order ? `(${arima.order.join(", ")})${arima.drift ? " + drift" : ""}` : "–",
    },
    { label: "Trained", l: fmtWhen(lstm?.trained_at), a: fmtWhen(arima?.trained_at) },
  ];
  return (
    <div className="card" style={{ minWidth: 0 }}>
      <CardTitle icon={LayersIcon} color="#8b5cf6" title="Model comparison" subtitle="Errors on the same held-out last 20% of the training window; lower is better" />
      <table>
        <thead>
          <tr>
            <th>Metric</th>
            <th style={{ color: COLORS.lstm }}>LSTM</th>
            <th style={{ color: COLORS.arima }}>ARIMA</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td style={{ textAlign: "left" }}>{r.label}</td>
              <td style={r.win === "lstm" ? { color: "#16a34a", fontWeight: 700 } : undefined}>{r.l}</td>
              <td style={r.win === "arima" ? { color: "#16a34a", fontWeight: 700 } : undefined}>{r.a}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Interpretation({ ticker, lstm, arima, horizon, signal, prob, bandLevel }) {
  const l = pointAt(lstm, horizon.days);
  const a = pointAt(arima, horizon.days);
  const sentences = [];
  if (l && a) {
    const ld = direction(l.change);
    const ad = direction(a.change);
    sentences.push(
      ld === ad
        ? `Both models forecast ${ticker} ${ld === "flat" ? "roughly flat" : ld} over ${horizon.name}: LSTM ${pct(l.change)} (${money(l.predicted_close)}), ARIMA ${pct(a.change)} (${money(a.predicted_close)}).`
        : `The models disagree over ${horizon.name}: LSTM ${pct(l.change)} (${money(l.predicted_close)}), ARIMA ${pct(a.change)} (${money(a.predicted_close)}).`
    );
  } else if (l || a) {
    const p = l || a;
    sentences.push(`Only ${l ? "LSTM" : "ARIMA"} has a forecast: ${pct(p.change)} (${money(p.predicted_close)}) over ${horizon.name}.`);
  }
  if (a?.lower_95 != null) {
    const width = ((a.upper_95 - a.lower_95) / 2 / arima.last_actual_close) * 100;
    sentences.push(`ARIMA's 95% interval at ${horizon.name} is ${money(a.lower_95)} – ${money(a.upper_95)} (±${width.toFixed(1)}%)${prob != null ? `, a ${Math.round(prob * 100)}% chance of closing above the last price` : ""}.`);
  }
  const measured = [["LSTM", l], ["ARIMA", a]].filter(([, p]) => p?.bands?.[bandLevel]);
  if (measured.length) {
    sentences.push(
      `Measured from each model's ${horizon.name}-ahead backtest errors, the ${bandLevel}% band is ${measured.map(([name, p]) => `${money(p.bands[bandLevel][0])} – ${money(p.bands[bandLevel][1])} (${name})`).join(" and ")}.`
    );
  }
  if (lstm?.test_rmse != null && arima?.test_rmse != null) {
    const winner = lstm.test_rmse < arima.test_rmse ? "LSTM" : "ARIMA";
    sentences.push(`${winner} had the lower test error (RMSE ${money(Math.min(lstm.test_rmse, arima.test_rmse))} vs ${money(Math.max(lstm.test_rmse, arima.test_rmse))}).`);
  }
  const factors = [
    signal && { label: signal.note, tone: signal.tone },
    prob != null && { label: `ARIMA P(rise) ${Math.round(prob * 100)}%`, tone: prob >= 0.5 ? "good" : "bad" },
    (lstm || arima) && { label: `data through ${lstm?.data_end || arima?.data_end}`, tone: "info" },
  ].filter(Boolean);

  return (
    <div className="card" style={{ minWidth: 0 }}>
      <CardTitle icon={LightbulbIcon} title="Forecast interpretation" subtitle={`What the numbers say for ${ticker} at ${horizon.name}`} />
      {signal ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
            <span className={`signal-word ${signal.tone}`}>{signal.label === "Bearish" ? "↓" : signal.label === "Bullish" ? "↑" : "→"} {signal.label}</span>
            {prob != null && <span className={`status-pill ${prob >= 0.5 ? "good" : "bad"}`}>ARIMA confidence {Math.round(prob * 100)}%</span>}
          </div>
          <p style={{ margin: "0 0 10px", lineHeight: 1.5 }}>{sentences.join(" ")}</p>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span className="muted">Key factors</span>
            {factors.map((f) => <span key={f.label} className={`status-pill ${f.tone}`}>{f.label}</span>)}
          </div>
          <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>Forecasts extrapolate past prices; use them as one input, not as investment advice.</p>
        </>
      ) : (
        <p className="muted">No forecast for {ticker} yet — click Forecast now above the chart.</p>
      )}
    </div>
  );
}

function RecentPredictions({ horizonKey, onOpen, refreshKey, onLoaded }) {
  const [data, setData] = useState({ predictions: [], total: 0 });
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    apiClient
      .get("/api/predictions/recent", { params: { limit: showAll ? ALL_RESULTS : 6 } })
      .then((r) => {
        setData(r.data);
        onLoaded?.(r.data.predictions);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAll, refreshKey]);
  return (
    <div className="card" style={{ minWidth: 0 }}>
      <CardTitle
        icon={ClockIcon}
        title="Recent predictions"
        subtitle={`Latest trained forecasts; signal at ${horizonKey}`}
        action={data.total > 6 && <button className="btn secondary btn-sm" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show recent" : `View all (${data.total})`}</button>}
      />
      <div style={{ maxHeight: showAll ? 360 : undefined, overflow: "auto" }}>
        <table>
          <thead>
            <tr><th>Ticker</th><th style={{ textAlign: "left" }}>Trained</th><th style={{ textAlign: "left" }}>Signal</th><th></th></tr>
          </thead>
          <tbody>
            {data.predictions.map((row) => {
              const sig = signalFor(horizonChange(row, "lstm", horizonKey), horizonChange(row, "arima", horizonKey));
              return (
                <tr key={row.ticker}>
                  <td title={row.name}><a style={{ cursor: "pointer" }} onClick={() => onOpen(row.ticker)}>{row.ticker}</a></td>
                  <td style={{ textAlign: "left" }}>{fmtWhen(row.trained_at)}</td>
                  <td style={{ textAlign: "left" }}>{sig ? <span className={`status-pill ${sig.tone}`} title={sig.note}>{sig.label}</span> : "–"}</td>
                  <td><button className="btn secondary btn-sm" onClick={() => onOpen(row.ticker)}>Open</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const TIPS = [
  { title: "Pick a ticker", text: "Type one and press Load, or click a recent one." },
  { title: "Forecast it", text: "Forecast now trains LSTM and ARIMA on the last 10 years (~2,515 days)." },
  { title: "Compare the models", text: "Agreement and the lower test error are the strongest evidence." },
  { title: "Use it in a workflow", text: "Prediction criteria apply the same rule to every screened company." },
];

export default function PredictionPage() {
  const [input, setInput] = useState(() => localStorage.getItem("forecastTicker") || "AAPL");
  const [ticker, setTicker] = useState(input);
  const [horizonKey, setHorizonKey] = useState(() => getSettings().forecast.horizon);
  const [range, setRange] = useState(() => getSettings().forecast.chart_range);
  const [bandLevel, setBandLevel] = useState(() => Number(getSettings().forecast.band_level) || 95);
  const [recentTickers, setRecentTickers] = useState([]);
  const [run, setRun] = useState(null);
  const [runError, setRunError] = useState(null);
  const [showDetails, setShowDetails] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const pollRef = useRef(null);
  const { loading, company, lstm, arima, error, reload } = useTickerData(ticker);

  const open = (t) => {
    const next = t.trim().toUpperCase();
    if (!next) return;
    setInput(next);
    setTicker(next);
    try {
      localStorage.setItem("forecastTicker", next);
    } catch {
      /* storage unavailable: just don't remember it */
    }
  };

  useEffect(() => () => clearTimeout(pollRef.current), []);

  const poll = (runId) => {
    apiClient
      .get(`/api/forecasts/batch/${runId}`)
      .then((r) => {
        setRun(r.data);
        if (r.data.finished) {
          reload();
          setRefreshKey((k) => k + 1);
        } else pollRef.current = setTimeout(() => poll(runId), 2000);
      })
      .catch((err) => {
        // Keep polling through a network blip; only a missing run stops it.
        if (err.response?.status === 404) setRunError(apiError(err));
        else pollRef.current = setTimeout(() => poll(runId), 10000);
      });
  };

  const forecastNow = () => {
    setRunError(null);
    apiClient
      .post("/api/forecasts/batch", { tickers: [ticker], lookback_days: Number(getSettings().forecast.training_days), epochs: Number(getSettings().forecast.lstm_epochs) })
      .then((r) => {
        setRun(r.data);
        poll(r.data.run_id);
      })
      .catch((err) => setRunError(apiError(err)));
  };

  const horizon = SIGNAL_HORIZONS.find((h) => h.key === horizonKey);
  const signal = signalFor(pointAt(lstm, horizon.days)?.change, pointAt(arima, horizon.days)?.change);
  const prob = probUp(arima, horizon.days);
  const history = company?.history || [];
  const lastRow = history[history.length - 1];
  const running = run && !run.finished;
  const done = run?.counts ? run.counts.lstm.done + run.counts.arima.done + run.counts.lstm.failed + run.counts.arima.failed : 0;
  const quick = (recentTickers.length ? recentTickers.map((r) => r.ticker) : tickerList(getSettings().forecast.quick_tickers)).slice(0, 5);

  return (
    <div>
      <PageHeader
        icon={TrendChartIcon}
        color="#06b6d4"
        title="Price forecasts"
        description="LSTM and ARIMA price forecasts per company, 1 day to 4 months ahead, side by side with the price history."
      />

      <div className="card search-card">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            open(input);
          }}
          style={{ display: "flex", gap: 8, flex: "1 1 360px", minWidth: 0 }}
        >
          <label className="search-box" htmlFor="forecast-ticker" style={{ flex: 1 }}>
            <SearchIcon width={15} height={15} />
            <input id="forecast-ticker" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ticker, e.g. AAPL" style={{ width: "100%" }} />
          </label>
          <button className="btn" type="submit">Load</button>
        </form>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span className="muted">{recentTickers.length ? "Recent:" : "Quick select:"}</span>
          {quick.map((t) => (
            <button key={t} className={`chip-btn ${t === ticker ? "active" : ""}`} onClick={() => open(t)}>{t}</button>
          ))}
        </div>
      </div>

      {error && <div className="card"><p className="error-text" style={{ margin: 0 }}>{error}</p></div>}

      <div className="stat-row">
        <div className="stat-card">
          <div className="icon-badge stat-card-icon" style={{ background: "#3b82f622", color: "#3b82f6" }}><SearchIcon width={24} height={24} /></div>
          <div style={{ minWidth: 0 }}>
            <div className="stat-card-label">Selected ticker</div>
            <div className="stat-card-value"><Link to={`/companies/${ticker}`}>{ticker}</Link></div>
            <div className="muted stat-card-sub" title={company?.company?.name}>{loading ? "Loading…" : company?.company?.name || "–"}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="icon-badge stat-card-icon" style={{ background: "#10b98122", color: "#10b981" }}><BarChartIcon width={24} height={24} /></div>
          <div style={{ minWidth: 0 }}>
            <div className="stat-card-label">Last close{lastRow ? ` · ${lastRow.date}` : ""}</div>
            <div className="stat-card-value">{money(lastRow?.close)}</div>
            <div className="stat-card-sub" style={{ color: tone(lastRow?.percentage_change), fontWeight: 600 }}>
              {lastRow?.percentage_change != null ? `${pct(lastRow.percentage_change)} vs previous day` : "–"}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="icon-badge stat-card-icon" style={{ background: "#8b5cf622", color: "#8b5cf6" }}><ClockIcon width={24} height={24} /></div>
          <div style={{ minWidth: 0 }}>
            <div className="stat-card-label">Forecast horizon</div>
            <div className="seg" style={{ margin: "4px 0" }}>
              {SIGNAL_HORIZONS.map((h) => (
                <button key={h.key} className={h.key === horizonKey ? "active" : ""} onClick={() => setHorizonKey(h.key)}>{h.key}</button>
              ))}
            </div>
            <div className="muted stat-card-sub">next {horizon.days} trading days</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="icon-badge stat-card-icon" style={{ background: "#06b6d422", color: "#06b6d4" }}><TrendChartIcon width={24} height={24} /></div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="stat-card-label">Model signal at {horizonKey}</div>
            <div className={`stat-card-value signal-word ${signal?.tone || ""}`}>{signal ? signal.label : "No forecast"}</div>
            {prob != null ? (
              <>
                <div className="muted stat-card-sub">ARIMA P(rise): {Math.round(prob * 100)}% · {signal?.note}</div>
                <div className="progress-bar" style={{ margin: "4px 0 0", height: 6 }}>
                  <div style={{ width: `${Math.round(prob * 100)}%`, background: prob >= 0.5 ? "#16a34a" : "#dc2626" }} />
                </div>
              </>
            ) : (
              <div className="muted stat-card-sub">{signal?.note || "forecast this ticker first"}</div>
            )}
          </div>
        </div>
      </div>

      <div className="card forecast-actions">
        <span className="muted" style={{ flex: 1, minWidth: 220 }}>
          {lstm || arima
            ? `Forecasts trained ${fmtWhen(lstm?.trained_at || arima?.trained_at)} on ${(lstm?.history_days || arima?.history_days || 0).toLocaleString()} days, data through ${lstm?.data_end || arima?.data_end}.`
            : `No stored forecast for ${ticker} yet.`}
          {running && ` Forecasting… ${done}/${(run.counts?.lstm.total || 0) + (run.counts?.arima.total || 0)} models done${run.queued ? " (waiting for a free worker)" : ""}.`}
        </span>
        {runError && <span className="error-text">{runError}</span>}
        <button className="btn" onClick={forecastNow} disabled={running || !company}>
          <TrendChartIcon width={15} height={15} /> {running ? "Forecasting…" : lstm || arima ? "Re-forecast (LSTM + ARIMA)" : "Forecast now"}
        </button>
        <button className="btn secondary" onClick={() => setShowDetails((v) => !v)}>{showDetails ? "Hide model details" : "Model details & settings"}</button>
      </div>

      <div className="forecast-grid">
        <PriceForecastCard ticker={ticker} company={company} lstm={lstm} arima={arima} range={range} setRange={setRange} bandLevel={bandLevel} setBandLevel={setBandLevel} />
        <PredictedPrices lstm={lstm} arima={arima} />
      </div>
      <div className="forecast-grid three">
        <ModelComparison lstm={lstm} arima={arima} />
        <Interpretation ticker={ticker} lstm={lstm} arima={arima} horizon={horizon} signal={signal} prob={prob} bandLevel={bandLevel} />
        <RecentPredictions horizonKey={horizonKey} onOpen={open} refreshKey={refreshKey} onLoaded={(rows) => !recentTickers.length && setRecentTickers(rows)} />
      </div>

      {showDetails && <ForecastPanels ticker={ticker} />}

      <QuickTipsBar subtitle="How to use price forecasts" tips={TIPS} />
    </div>
  );
}
