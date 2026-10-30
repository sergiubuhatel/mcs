import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { fetchExistingRequested, trainRequested } from "./arimaSlice";
import { TrendChartIcon } from "../../layout/icons";
import { HorizonTable, NextDaysTable, money } from "../predictions/ForecastTables";
import { busyText, useBusyByOthers } from "../activity/runningJobs";

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

  const busy = useBusyByOthers("forecast");
  const start = () => dispatch(trainRequested({ ticker, lookback_days: Number(lookbackDays) }));

  return (
    <div className="card">
      <h3>ARIMA price forecast</h3>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <button className="btn" onClick={start} disabled={training || !!busy}>
          <TrendChartIcon /> {training ? "Fitting..." : "Fit / refit ARIMA"}
        </button>
        {!training && busy && <span className="busy-hint">{busyText(busy)}</span>}
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
            Order: <strong>ARIMA{orderLabel(result.order)}{result.drift ? " with drift" : ""}</strong> · AIC: <strong>{result.aic?.toFixed(1) ?? "-"}</strong> · Test RMSE:{" "}
            <strong>{result.test_rmse?.toFixed(2) ?? "-"}</strong> · Test MAE: <strong>{result.test_mae?.toFixed(2) ?? "-"}</strong> · fitted on{" "}
            {result.history_days} days{result.test_days !== undefined && <>, tested on last {result.test_days}</>}
            {result.last_actual_close !== undefined && <> · Last close: <strong>{money(result.last_actual_close)}</strong></>}
          </p>
          <HorizonTable result={result} withInterval />
          <NextDaysTable result={result} withInterval />
        </div>
      )}
    </div>
  );
}
