import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { fetchExistingRequested, trainRequested } from "./predictionsSlice";
import { TrendChartIcon } from "../../layout/icons";
import { HorizonTable, NextDaysTable, money } from "./ForecastTables";

export default function PredictionPanel({ ticker, lookbackDays }) {
  const dispatch = useDispatch();
  const { status, progress, result, error } = useSelector((s) => s.predictions);
  const [epochs, setEpochs] = useState(100);

  useEffect(() => {
    dispatch(fetchExistingRequested(ticker));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  const training = status === "starting" || status === "training";
  const pct = progress && progress.total ? Math.min(100, Math.round((progress.completed / progress.total) * 100)) : 0;

  const start = () => dispatch(trainRequested({ ticker, epochs: Number(epochs), seq_len: 20, lookback_days: lookbackDays }));

  return (
    <div className="card">
      <h3>LSTM price forecast</h3>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <div>
          <label style={{ display: "block", fontSize: "0.78rem", color: "var(--color-text-secondary)" }}>Max epochs</label>
          <input type="number" value={epochs} onChange={(e) => setEpochs(e.target.value)} style={{ width: 90 }} disabled={training} />
        </div>
        <button className="btn" onClick={start} disabled={training}>
          <TrendChartIcon /> {training ? "Training..." : "Train / retrain LSTM"}
        </button>
      </div>

      {training && (
        <div>
          <div className="progress-bar"><div style={{ width: `${pct}%` }} /></div>
          <p className="muted">{progress ? `epoch ${progress.completed}/${progress.total} (stops early when validation loss stalls), loss ${progress.loss?.toFixed?.(4) ?? "-"}, val ${progress.val_loss?.toFixed?.(4) ?? "-"}` : "Starting..."}</p>
        </div>
      )}
      {status === "error" && <p className="error-text">{error}</p>}

      {result && (
        <div>
          <p className="muted">
            Test RMSE: <strong>{result.test_rmse?.toFixed(2) ?? "-"}</strong> · Test MAE:{" "}
            <strong>{result.test_mae?.toFixed(2) ?? "-"}</strong> · trained on {result.history_days} days{result.test_days !== undefined && <>, tested on last {result.test_days}</>}
            {result.best_epoch !== undefined && <> · best epoch {result.best_epoch}/{result.epochs_run} (seed {result.seed})</>}
            {result.last_actual_close !== undefined && <> · Last close: <strong>{money(result.last_actual_close)}</strong></>}
          </p>
          <HorizonTable result={result} />
          <NextDaysTable result={result} />
        </div>
      )}
    </div>
  );
}
