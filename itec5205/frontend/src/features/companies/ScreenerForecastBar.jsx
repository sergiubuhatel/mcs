import { useCallback, useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { apiClient } from "../../api/client";
import { TrendChartIcon } from "../../layout/icons";
import { SignalBadge, progressText } from "../signals/SignalBoard";
import { buildParams, screenCriteria } from "./companiesSaga";
import { fetchRequested, selectTickers, setSignals } from "./companiesSlice";

const RUN_KEY = "screenerForecastRun";

// Every ticker matching the current search (all pages, not just the visible one).
async function allResultTickers(filters) {
  const { data } = await apiClient.get("/api/companies", { params: { ...buildParams(filters), limit: 600, offset: 0 } });
  return data.results.map((r) => r.ticker);
}

/** "Forecast all" for the screener: LSTM + ARIMA over every result, then the
 * compound signal (fundamentals + LSTM + ARIMA) per company in the grid. */
export default function ScreenerForecastBar() {
  const dispatch = useDispatch();
  const { filters, results, signals } = useSelector((s) => s.companies);
  const strongTickers = Object.keys(signals).filter((t) => signals[t] === "Strong");
  const [summary, setSummary] = useState(null);
  const [run, setRun] = useState(null);
  const [error, setError] = useState(null);
  const [trainingDays, setTrainingDays] = useState(2515);
  const [epochs, setEpochs] = useState(100);
  const pollRef = useRef(null);
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
      apiClient
        .get(`/api/forecasts/batch/${runId}`)
        .then((res) => {
          setRun(res.data);
          if (res.data.finished) loadSignals();
          else pollRef.current = setTimeout(() => poll(runId), 2000);
        })
        .catch(() => localStorage.removeItem(RUN_KEY));
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
    setError(null);
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
    }
  };

  const cancel = () => {
    clearTimeout(pollRef.current);
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

  return (
    <div className="card">
      <h3>Forecast &amp; categorize results</h3>
      <p className="muted">
        Runs LSTM and ARIMA on every company in the results (all pages), then rates each one in the grid's Signal
        column: <strong>Strong</strong> = passes the screen and both models forecast up at 1, 2, 3 and 4 months;{" "}
        <strong>Avoid</strong> = both models agree on down; <strong>Mixed</strong> / <strong>Weak</strong> in between.
      </p>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <label style={{ display: "block", fontSize: "0.78rem", color: "var(--color-text-secondary)" }}>Training days</label>
          <input type="number" min={120} value={trainingDays} onChange={(e) => setTrainingDays(e.target.value)} style={{ width: 90 }} disabled={running} />
        </div>
        <div>
          <label style={{ display: "block", fontSize: "0.78rem", color: "var(--color-text-secondary)" }}>LSTM max epochs</label>
          <input type="number" min={1} value={epochs} onChange={(e) => setEpochs(e.target.value)} style={{ width: 90 }} disabled={running} />
        </div>
        <button className="btn" onClick={forecastAll} disabled={running || results.length === 0}>
          <TrendChartIcon /> {running ? "Forecasting..." : "Forecast all (LSTM + ARIMA)"}
        </button>
        {running && (
          <button className="btn secondary" onClick={cancel} title="Stop this run's remaining jobs">
            Cancel
          </button>
        )}
        {summary && (
          <span style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginLeft: 8 }}>
            {["Strong", "Mixed", "Weak", "Avoid"].map((k) => (
              <span key={k}><SignalBadge signal={k} /> {summary[k]}</span>
            ))}
            {summary.missing_forecasts > 0 && <span className="muted">· {summary.missing_forecasts} without both forecasts</span>}
          </span>
        )}
        <button
          className="btn secondary"
          onClick={() => dispatch(selectTickers(strongTickers))}
          disabled={strongTickers.length === 0}
          title="Add every Strong company (all pages) to the pool selection"
        >
          Select all Strong ({strongTickers.length})
        </button>
      </div>
      {run && (
        <div style={{ marginTop: 8 }}>
          {running && <div className="progress-bar"><div style={{ width: `${pct}%` }} /></div>}
          <p className="muted" style={{ margin: "4px 0" }}>
            {run.queued && <strong>Waiting in queue behind other forecast runs · </strong>}
            {run.cancelled && <strong>Cancelled · </strong>}
            {progressText(run)}
            {run.finished && !run.cancelled && run.wall_seconds != null && ` · finished in ${run.wall_seconds.toFixed(1)} s`}
          </p>
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
