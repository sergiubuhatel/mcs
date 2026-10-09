import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { fetchExistingRequested, trainRequested } from "./arimaSlice";
import { TrendChartIcon } from "../../layout/icons";

function changeColor(value) {
  if (value === null || value === undefined || value === 0) return "var(--color-text-primary)";
  return value > 0 ? "#16a34a" : "#dc2626";
}

function ChangeBadge({ value }) {
  if (value === null || value === undefined) return <span className="muted">-</span>;
  const arrow = value > 0 ? "▲ " : value < 0 ? "▼ " : "";
  const sign = value > 0 ? "+" : "";
  return (
    <span style={{ color: changeColor(value), fontWeight: value === 0 ? 400 : 600 }}>
      {arrow}{sign}{value.toFixed(2)}%
    </span>
  );
}

const orderLabel = (order) => (order ? `(${order.join(", ")})` : "-");

export default function ArimaPanel({ ticker, lookbackDays }) {
  const dispatch = useDispatch();
  const { status, progress, result, error } = useSelector((s) => s.arima);

  useEffect(() => {
    dispatch(fetchExistingRequested(ticker));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  const training = status === "starting" || status === "training";
  const pct = progress && progress.total ? Math.min(100, Math.round((progress.completed / progress.total) * 100)) : 0;

  const start = () => dispatch(trainRequested({ ticker, lookback_days: Number(lookbackDays), forecast_days: 7 }));

  return (
    <div className="card">
      <h3>ARIMA price forecast</h3>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <button className="btn" onClick={start} disabled={training}>
          <TrendChartIcon /> {training ? "Fitting..." : "Fit / refit ARIMA"}
        </button>
      </div>

      {training && (
        <div>
          <div className="progress-bar"><div style={{ width: `${pct}%` }} /></div>
          <p className="muted">
            {progress
              ? `order ${progress.completed}/${progress.total}: ARIMA${orderLabel(progress.order)}, AIC ${progress.aic?.toFixed?.(1) ?? "-"} · best so far ${orderLabel(progress.best_order)}`
              : "Starting..."}
          </p>
        </div>
      )}
      {status === "error" && <p className="error-text">{error}</p>}

      {result && (
        <div>
          <p className="muted">
            Order: <strong>ARIMA{orderLabel(result.order)}</strong> · AIC: <strong>{result.aic?.toFixed(1) ?? "-"}</strong> · Test RMSE:{" "}
            <strong>{result.test_rmse?.toFixed(2) ?? "-"}</strong> · Test MAE: <strong>{result.test_mae?.toFixed(2) ?? "-"}</strong> · fitted on{" "}
            {result.history_days} days{result.test_days !== undefined && <>, tested on last {result.test_days}</>}
            {result.last_actual_close !== undefined && <> · Last close: <strong>${result.last_actual_close}</strong></>}
          </p>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Predicted close</th>
                <th>Predict Change</th>
                <th>95% interval</th>
              </tr>
            </thead>
            <tbody>
              {result.forecast?.map((f) => (
                <tr key={f.date}>
                  <td>{f.date}</td>
                  <td style={{ color: changeColor(f.change_pct_from_prior_day), fontWeight: 600 }}>${f.predicted_close}</td>
                  <td><ChangeBadge value={f.change_pct_from_prior_day} /></td>
                  <td className="muted">${f.lower_95} – ${f.upper_95}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
