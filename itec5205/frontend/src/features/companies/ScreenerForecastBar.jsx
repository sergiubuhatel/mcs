import { useCallback, useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { apiClient } from "../../api/client";
import { ArrowDownRightIcon, BarChartIcon, CheckIcon, MixedIcon, TrendDownIcon, TrendChartIcon, TrendUpIcon } from "../../layout/icons";
import { progressText } from "../signals/SignalBoard";
import { ALL_RESULTS, buildParams, screenCriteria } from "./companiesSaga";
import { fetchRequested, selectTickers, setFilters, setSignals } from "./companiesSlice";
import { getSettings } from "../settings/settings";

const RUN_KEY = "screenerForecastRun";

// Every ticker matching the current search (all pages, not just the visible one).
async function allResultTickers(filters) {
  const { data } = await apiClient.get("/api/companies", { params: { ...buildParams(filters), limit: ALL_RESULTS, offset: 0 } });
  return data.results.map((r) => r.ticker);
}

// Tile look per signal; `tone` drives the tile's tinted border/background.
export const SIGNAL_TILES = [
  { key: "Strong", color: "#16a34a", icon: TrendUpIcon, hint: "Passes the screen and LSTM + ARIMA both forecast up at 1, 2, 3 and 4 months" },
  { key: "Mixed", color: "#d97706", icon: MixedIcon, hint: "Some evidence up, some not" },
  { key: "Weak", color: "#64748b", icon: TrendDownIcon, hint: "Little support, or forecasts missing" },
  { key: "Avoid", color: "#dc2626", icon: ArrowDownRightIcon, hint: "LSTM and ARIMA agree on down" },
];

/** Forecast Analysis for the screener: LSTM + ARIMA over every result, then
 * the compound signal (fundamentals + LSTM + ARIMA) per company in the grid.
 * Clicking a tile filters the results to that signal. */
export default function ScreenerForecastBar() {
  const dispatch = useDispatch();
  const { filters, results, signals } = useSelector((s) => s.companies);
  const signalFilter = filters.signal;
  const strongTickers = Object.keys(signals).filter((t) => signals[t] === "Strong");
  const [summary, setSummary] = useState(null);
  const [run, setRun] = useState(null);
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(false);
  const [trainingDays, setTrainingDays] = useState(() => getSettings().forecast.training_days);
  const [epochs, setEpochs] = useState(() => getSettings().forecast.lstm_epochs);
  const pollRef = useRef(null);
  const runIdRef = useRef(null); // responses for any other run are stale
  const loadedKey = useRef(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const loadSignals = useCallback(async () => {
    try {
      const tickers = await allResultTickers(filtersRef.current);
      if (!tickers.length) {
        dispatch(setSignals({}));
        setSummary(null);
        return;
      }
      const { data } = await apiClient.post("/api/signals", { tickers });
      dispatch(setSignals(Object.fromEntries(data.rows.map((r) => [r.ticker, r.signal]))));
      setSummary(data.summary);
      // A grid sorted by signal was ordered with the previous ratings.
      if (filtersRef.current.sortBy === "signal") dispatch(fetchRequested());
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  }, [dispatch]);

  // Re-categorize when the search criteria change (not on sort/paging).
  useEffect(() => {
    const key = JSON.stringify(screenCriteria(filters));
    if (key !== loadedKey.current) {
      loadedKey.current = key;
      loadSignals();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results]);

  const poll = useCallback(
    (runId) => {
      clearTimeout(pollRef.current);
      runIdRef.current = runId;
      apiClient
        .get(`/api/forecasts/batch/${runId}`)
        .then((res) => {
          if (runIdRef.current !== runId) return;
          setRun(res.data);
          if (res.data.finished) loadSignals();
          else pollRef.current = setTimeout(() => poll(runId), 2000);
        })
        .catch((err) => {
          if (runIdRef.current !== runId) return;
          // Only a deleted run ends polling; a network blip (sleep, backend
          // restart) retries, or the progress would freeze where it was.
          if (err.response?.status === 404) localStorage.removeItem(RUN_KEY);
          else pollRef.current = setTimeout(() => poll(runId), 10000);
        });
    },
    [loadSignals]
  );

  // Resume a run still going after navigating away and back.
  useEffect(() => {
    const runId = localStorage.getItem(RUN_KEY);
    if (runId) poll(runId);
    return () => clearTimeout(pollRef.current);
  }, [poll]);

  const forecastAll = async () => {
    if (starting) return;
    setError(null);
    setStarting(true);
    try {
      const tickers = await allResultTickers(filters);
      if (!tickers.length) return;
      const { data } = await apiClient.post("/api/forecasts/batch", {
        tickers,
        lookback_days: Number(trainingDays),
        epochs: Number(epochs),
      });
      localStorage.setItem(RUN_KEY, data.run_id);
      setRun(data);
      poll(data.run_id);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setStarting(false);
    }
  };

  const cancel = () => {
    clearTimeout(pollRef.current);
    runIdRef.current = run.run_id;
    apiClient
      .post(`/api/forecasts/batch/${run.run_id}/cancel`)
      .then((res) => {
        setRun(res.data);
        loadSignals();
      })
      .catch((err) => setError(err.response?.data?.error || err.message));
  };

  const running = run && !run.finished;
  const c = run?.counts;
  const done = c ? c.lstm.done + c.lstm.failed + c.arima.done + c.arima.failed : 0;
  const total = c ? c.lstm.total + c.arima.total : 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const evaluated = summary ? SIGNAL_TILES.reduce((n, t) => n + (summary[t.key] || 0), 0) : 0;
  const share = (k) => (evaluated ? ((summary[k] || 0) / evaluated) * 100 : 0);

  const filterBySignal = (k) => {
    dispatch(setFilters({ signal: signalFilter === k ? "" : k, offset: 0 }));
    dispatch(fetchRequested());
  };

  return (
    <div className="card">
      <div className="card-header" style={{ flexWrap: "wrap" }}>
        <div className="icon-badge" style={{ background: "rgba(59,130,246,0.15)", color: "#3b82f6", width: 44, height: 44, borderRadius: 11 }}>
          <BarChartIcon width={22} height={22} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 style={{ margin: 0 }}>Forecast Analysis</h3>
          <p className="muted" style={{ margin: 0 }}>Evaluate the screened companies (all pages) with the ARIMA and LSTM models</p>
        </div>
        <div className="forecast-controls">
          <label>
            Training days
            <input type="number" min={120} value={trainingDays} onChange={(e) => setTrainingDays(e.target.value)} disabled={running} />
          </label>
          <label>
            LSTM epochs
            <input type="number" min={1} value={epochs} onChange={(e) => setEpochs(e.target.value)} disabled={running} />
          </label>
          {running ? (
            <button className="btn secondary" onClick={cancel} title="Stop this run's remaining jobs">Cancel run</button>
          ) : (
            <button className="btn" onClick={forecastAll} disabled={results.length === 0 || starting}>
              <TrendChartIcon /> {starting ? "Queuing forecasts…" : "Run Forecasts (LSTM + ARIMA)"}
            </button>
          )}
        </div>
      </div>

      <div className="signal-tiles">
        {SIGNAL_TILES.map(({ key, color, icon: Icon, hint }) => (
          <button
            key={key}
            type="button"
            className={`signal-tile ${signalFilter === key ? "active" : ""}`}
            style={{ "--tile": color }}
            onClick={() => filterBySignal(key)}
            title={`${hint}. Click to ${signalFilter === key ? "show all results" : `show only ${key}`}.`}
            aria-pressed={signalFilter === key}
          >
            <span className="signal-tile-icon"><Icon width={22} height={22} /></span>
            <span style={{ minWidth: 0 }}>
              <span className="signal-tile-label">{key}</span>
              <span className="signal-tile-value">
                {summary ? summary[key] || 0 : "–"}
                <span className="muted">{summary ? `${share(key).toFixed(1)}% of ${evaluated}` : "not rated yet"}</span>
              </span>
            </span>
          </button>
        ))}
      </div>

      <div className="signal-bar" aria-label="Signal distribution">
        {evaluated > 0
          ? SIGNAL_TILES.map(({ key, color }) => share(key) > 0 && <div key={key} style={{ width: `${share(key)}%`, background: color }} title={`${key}: ${summary[key]}`} />)
          : <div style={{ width: "100%", background: "var(--color-bg-tertiary)" }} />}
      </div>

      {run && (running || run.cancelled || run.queued) && (
        <div style={{ marginTop: 8 }}>
          {running && <div className="progress-bar thin"><div style={{ width: `${pct}%` }} /></div>}
          <p className="muted" style={{ margin: "4px 0", fontSize: "0.82rem" }}>
            {run.queued && <strong>Waiting in queue behind other forecast runs · </strong>}
            {run.cancelled && <strong>Cancelled · </strong>}
            {running ? `Forecasting ${pct}% · ` : ""}
            {progressText(run)}
          </p>
        </div>
      )}

      <div className="forecast-footer">
        <span className="muted">
          <strong style={{ color: "var(--color-text-primary)" }}>{evaluated}</strong> companies evaluated
          {summary?.missing_forecasts > 0 && ` · ${summary.missing_forecasts} without both forecasts`}
          {run?.finished && !run.cancelled && run.wall_seconds != null && ` · last run took ${run.wall_seconds.toFixed(1)} s`}
          {signalFilter && (
            <>
              {" · "}showing only <strong>{signalFilter}</strong>{" "}
              <button type="button" className="link-btn" style={{ display: "inline", color: "var(--btn-accent)" }} onClick={() => filterBySignal(signalFilter)}>show all</button>
            </>
          )}
        </span>
        <button
          className="btn secondary btn-sm"
          onClick={() => dispatch(selectTickers(strongTickers))}
          disabled={strongTickers.length === 0}
          title="Add every Strong company (all pages) to the pool selection"
        >
          <CheckIcon width={14} height={14} /> Select All Strong ({strongTickers.length})
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
