import { useState } from "react";
import PredictionPanel from "./PredictionPanel";
import ArimaPanel from "../arima/ArimaPanel";

// Matches DEFAULT_LOOKBACK_DAYS in backend/app/services/lstm_service.py (~3 trading years).
const DEFAULT_TRAINING_DAYS = 756;

// One "Training days" value drives both models, so the LSTM and ARIMA always
// learn from the same window and are scored on the same held-out days.
export default function ForecastPanels({ ticker }) {
  const [trainingDays, setTrainingDays] = useState(DEFAULT_TRAINING_DAYS);
  const days = Math.max(0, Number(trainingDays) || 0);

  return (
    <>
      <div className="card">
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.78rem", color: "var(--color-text-secondary)" }}>Training days</label>
            <input type="number" min={120} value={trainingDays} onChange={(e) => setTrainingDays(e.target.value)} style={{ width: 110 }} />
          </div>
          <p className="muted" style={{ margin: 0 }}>
            Most recent trading days used by both LSTM and ARIMA. The last 20% ({Math.round(days * 0.2)} days) are held out to
            compute test RMSE/MAE on the same days for both models. Minimum 120.
          </p>
        </div>
      </div>
      <PredictionPanel ticker={ticker} lookbackDays={days} />
      <ArimaPanel ticker={ticker} lookbackDays={days} />
    </>
  );
}
