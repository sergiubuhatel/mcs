import { useState } from "react";
import { getSettings } from "../settings/settings";

export function changeColor(value) {
  if (value === null || value === undefined || value === 0) return "var(--color-text-primary)";
  return value > 0 ? "#16a34a" : "#dc2626";
}

// `value` is an unrounded % change; a tiny non-zero move still gets its
// arrow/color and shows as "<0.01%" instead of a misleading neutral "0.00%".
export function ChangeBadge({ value }) {
  if (value === null || value === undefined) return <span className="muted">-</span>;
  const arrow = value > 0 ? "▲ " : value < 0 ? "▼ " : "";
  const tiny = Math.abs(value) > 0 && Math.abs(value) < 0.005;
  const sign = tiny ? "" : value > 0 ? "+" : value < 0 ? "-" : "";
  const text = tiny ? "<0.01" : Math.abs(value).toFixed(2);
  return (
    <span style={{ color: changeColor(value), fontWeight: value === 0 ? 400 : 600 }}>
      {arrow}{sign}{text}%
    </span>
  );
}

export const money = (v) => (v === null || v === undefined ? "-" : `$${Number(v).toFixed(2)}`);

// 1-4 month horizons, in trading days -- matches backend services/horizons.py.
export const HORIZONS = [
  { label: "1M", name: "1 month", days: 21 },
  { label: "2M", name: "2 months", days: 42 },
  { label: "3M", name: "3 months", days: 63 },
  { label: "4M", name: "4 months", days: 84 },
];

// Price at each horizon vs. the last actual close. This is what LSTM/ARIMA
// agreement and the signal board are based on.
export function HorizonTable({ result, withInterval = false }) {
  const last = result.last_actual_close;
  const rows = HORIZONS.map((h) => ({ ...h, point: result.forecast?.[h.days - 1] })).filter((h) => h.point);
  if (rows.length === 0) {
    return <p className="muted">This forecast predates the 1–4 month horizons — retrain to see them.</p>;
  }
  return (
    <table>
      <thead>
        <tr>
          <th>Horizon</th>
          <th>Date</th>
          <th>Predicted close</th>
          <th>Change vs last close</th>
          {withInterval && <th>95% interval</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map(({ label, name, point }) => {
          const change = last ? ((point.predicted_close - last) / last) * 100 : null;
          return (
            <tr key={label}>
              <td><strong>{name}</strong></td>
              <td>{point.date}</td>
              <td style={{ color: changeColor(change), fontWeight: 600 }}>{money(point.predicted_close)}</td>
              <td><ChangeBadge value={change} /></td>
              {withInterval && (
                // Each bound vs. the last actual close: below = possible loss (red), above = possible gain (green).
                <td>
                  <span style={{ color: changeColor(point.lower_95 - last), fontWeight: 600 }}>{money(point.lower_95)}</span>
                  {" – "}
                  <span style={{ color: changeColor(point.upper_95 - last), fontWeight: 600 }}>{money(point.upper_95)}</span>
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// Short-term view (display only -- not part of agreement/signals): the first
// N daily forecast steps, each colored vs. the day before.
export function NextDaysTable({ result, withInterval = false }) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(() => getSettings().general.next_days);
  const forecast = result.forecast || [];
  const n = Math.max(1, Math.min(forecast.length, Number(days) || 1));
  const rows = forecast.slice(0, n).map((f, i) => {
    const prev = i === 0 ? result.last_actual_close : forecast[i - 1].predicted_close;
    return { ...f, dayChange: prev ? ((f.predicted_close - prev) / prev) * 100 : null };
  });

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn secondary" style={{ padding: "4px 10px", fontSize: "0.8rem" }} onClick={() => setOpen(!open)}>
          {open ? "Hide next days" : "Show next days"}
        </button>
        {open && (
          <label className="muted" style={{ fontSize: "0.8rem", display: "flex", alignItems: "center", gap: 6 }}>
            Days
            <input type="number" min={1} max={forecast.length} value={days} onChange={(e) => setDays(e.target.value)} style={{ width: 64 }} />
            <span>(short-term view only, not used for agreement)</span>
          </label>
        )}
      </div>
      {open && (
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Predicted close</th>
              <th>Predict Change</th>
              {withInterval && <th>95% interval</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.date}>
                <td>{f.date}</td>
                <td style={{ color: changeColor(f.dayChange), fontWeight: 600 }}>{money(f.predicted_close)}</td>
                <td><ChangeBadge value={f.dayChange} /></td>
                {withInterval && (
                  <td>
                    <span style={{ color: changeColor(f.lower_95 - result.last_actual_close), fontWeight: 600 }}>{money(f.lower_95)}</span>
                    {" – "}
                    <span style={{ color: changeColor(f.upper_95 - result.last_actual_close), fontWeight: 600 }}>{money(f.upper_95)}</span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
