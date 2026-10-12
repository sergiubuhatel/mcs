import { useMemo } from "react";
import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { tooltipProps } from "../utils/chartTheme";

// Same colors as the Price Forecasts page; the history line stays the fixed blue.
export const FORECAST_COLORS = { history: "#2563eb", lstm: "#16a34a", arima: "#a855f7" };
const BAND = "ARIMA 95% interval";

/**
 * History plus, after it, the LSTM / ARIMA forecast paths and ARIMA's 95%
 * band (the "beam"), joined at the last actual point.
 * @param history  [{date, value}] (already cut to the chosen range)
 * @param forecast {dates, lstm?, arima?, lower?, upper?} in the same units as
 *   `value`, or null to draw the history only
 * @param format   value -> label (axis, tooltip)
 * @param area     fill under the history line (portfolio index style)
 */
export default function ForecastChart({ history, forecast, format, historyName = "Price", area = false, height = 260 }) {
  const has = (k) => !!forecast?.[k]?.length;
  const data = useMemo(() => {
    if (!history.length) return [];
    const rows = history.map((h) => ({ date: h.date, value: h.value }));
    if (!forecast) return rows;
    const last = rows[rows.length - 1];
    rows[rows.length - 1] = {
      ...last,
      lstm: has("lstm") ? last.value : undefined,
      arima: has("arima") ? last.value : undefined,
      band: has("lower") ? [last.value, last.value] : undefined,
    };
    forecast.dates.forEach((date, i) => {
      if (date <= last.date) return;
      rows.push({
        date,
        lstm: forecast.lstm?.[i],
        arima: forecast.arima?.[i],
        band: has("lower") ? [forecast.lower[i], forecast.upper[i]] : undefined,
      });
    });
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, forecast]);
  const lastDate = history[history.length - 1]?.date;

  if (!data.length) return null;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="historyFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={FORECAST_COLORS.history} stopOpacity={0.4} />
            <stop offset="100%" stopColor={FORECAST_COLORS.history} stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-divider)" />
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--color-text-secondary)" }} minTickGap={50} />
        <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10, fill: "var(--color-text-secondary)" }} tickFormatter={format} width={58} />
        <Tooltip
          {...tooltipProps}
          formatter={(value, name) => (name === BAND ? [`${format(value[0])} – ${format(value[1])}`, name] : [format(value), name])}
        />
        {forecast && <Legend wrapperStyle={{ fontSize: "0.78rem" }} />}
        {has("lower") && <Area dataKey="band" name={BAND} stroke="none" fill={FORECAST_COLORS.arima} fillOpacity={0.14} isAnimationActive={false} connectNulls />}
        {area ? (
          <Area dataKey="value" name={historyName} stroke={FORECAST_COLORS.history} strokeWidth={2.5} fill="url(#historyFill)" dot={false} isAnimationActive={false} />
        ) : (
          <Line dataKey="value" name={historyName} stroke={FORECAST_COLORS.history} strokeWidth={2.5} dot={false} isAnimationActive={false} />
        )}
        {has("lstm") && <Line dataKey="lstm" name="LSTM forecast" stroke={FORECAST_COLORS.lstm} strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} connectNulls />}
        {has("arima") && <Line dataKey="arima" name="ARIMA forecast" stroke={FORECAST_COLORS.arima} strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} connectNulls />}
        {forecast && lastDate && (
          <ReferenceLine x={lastDate} stroke="var(--color-text-secondary)" strokeDasharray="3 3" label={{ value: "Forecast →", position: "insideTopRight", fontSize: 11, fill: "var(--color-text-secondary)" }} />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
