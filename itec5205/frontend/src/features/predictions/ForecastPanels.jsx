import { useEffect, useState } from "react";
import { apiClient } from "../../api/client";
import PredictionPanel from "./PredictionPanel";
import ArimaPanel from "../arima/ArimaPanel";

// Matches DEFAULT_LOOKBACK_DAYS in backend/app/services/lstm_service.py (~10 trading years).
const DEFAULT_TRAINING_DAYS = 2515;

function changeColor(value) {
  if (value === null || value === undefined || value === 0) return "var(--color-text-primary)";
  return value > 0 ? "#16a34a" : "#dc2626";
}

// One "Training days" value drives both models, so the LSTM and ARIMA always
// learn from the same window and are scored on the same held-out days.
export default function ForecastPanels({ ticker }) {
  const [trainingDays, setTrainingDays] = useState(DEFAULT_TRAINING_DAYS);
  const days = Math.max(0, Number(trainingDays) || 0);
  // Last stored daily close (the price both models forecast from) and its % move vs. the previous day.
  const [lastClose, setLastClose] = useState(null);

  useEffect(() => {
    setLastClose(null);
    apiClient
      .get(`/api/companies/${ticker}`)
      .then((res) => {
        const history = res.data.history || [];
        const last = history[history.length - 1];
        if (last) setLastClose({ date: last.date, close: last.close, changePct: last.percentage_change });
      })
      .catch(() => setLastClose(null));
  }, [ticker]);

  return (
    <>
      <div className="card">
        <h3 style={{ marginBottom: 2 }}>{ticker} price forecast</h3>
        {lastClose && (
          <p style={{ marginTop: 0 }}>
            Last close ({lastClose.date}):{" "}
            <span style={{ color: changeColor(lastClose.changePct), fontWeight: 600 }}>
              ${Number(lastClose.close).toFixed(2)}
              {lastClose.changePct !== null && lastClose.changePct !== undefined && (
                <>
                  {" "}
                  {lastClose.changePct > 0 ? "▲ +" : lastClose.changePct < 0 ? "▼ " : ""}
                  {Number(lastClose.changePct).toFixed(2)}%
                </>
              )}
            </span>{" "}
            <span className="muted">vs. previous day</span>
          </p>
        )}
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.78rem", color: "var(--color-text-secondary)" }}>Training days</label>
            <input type="number" min={120} value={trainingDays} onChange={(e) => setTrainingDays(e.target.value)} style={{ width: 110 }} />
          </div>
          <p className="muted" style={{ margin: 0 }}>
            Most recent trading days used by both LSTM and ARIMA. The last 20% ({days - Math.floor(days * 0.8)} days) are held out to
            compute test RMSE/MAE on the same days for both models. Minimum 120. Both forecast 1, 2, 3 and 4 months ahead.
          </p>
        </div>
      </div>
      <PredictionPanel ticker={ticker} lookbackDays={days} />
      <ArimaPanel ticker={ticker} lookbackDays={days} />
    </>
  );
}
