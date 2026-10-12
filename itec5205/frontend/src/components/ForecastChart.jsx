import { useMemo } from "react";
import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { tooltipProps } from "../utils/chartTheme";

// Same colors as the Price Forecasts page; the history line stays the fixed blue.
export const FORECAST_COLORS = { history: "#2563eb", lstm: "#16a34a", arima: "#a855f7" };
// Confidence levels the forecast bands are measured at (backend horizons.BAND_LEVELS).
export const BAND_LEVELS = [50, 75, 80, 90, 95, 99];
export const DEFAULT_BAND_LEVEL = 95;
// Two-sided normal z per level: scales an older forecast's 95% band to another level.
const Z = { 50: 0.6745, 75: 1.1503, 80: 1.2816, 90: 1.6449, 95: 1.96, 99: 2.5758 };
const bandName = (model, level, isModel) =>
  isModel ? `${model} ${level}% interval (model; retrain for the measured band)` : `${model} ${level}% band`;

/**
 * Chart input from the stored /api/predictions (LSTM) and /api/arima docs:
 * one point per forecast day. Each model's band is the `level`% range
 * measured from its own backtest errors at that step (`bands`). Forecasts
 * trained before the levels existed have only a 95% band (measured
 * band_low / band_high, or ARIMA's model interval lower_95 / upper_95),
 * scaled to `level` around the forecast.
 */
export function forecastFromDocs(lstm, arima, level = DEFAULT_BAND_LEVEL) {
  const ref = arima?.forecast?.length ? arima : lstm;
  if (!ref?.forecast?.length) return null;
  const byDate = (doc) => Object.fromEntries((doc?.forecast || []).map((p) => [p.date, p]));
  const l = byDate(lstm);
  const a = byDate(arima);
  const dates = ref.forecast.map((p) => p.date);
  const scale = Z[level] / Z[95];
  const pointBand = (p, lo, hi) => {
    if (lo === "bands") return p?.bands?.[level] || null;
    if (p?.[lo] == null) return null;
    const mid = p.predicted_close;
    return [mid - (mid - p[lo]) * scale, mid + (p[hi] - mid) * scale];
  };
  const band = (points, lo, hi) => {
    const pairs = points.map((p) => pointBand(p, lo, hi));
    return pairs.every(Boolean) ? { low: pairs.map((b) => b[0]), high: pairs.map((b) => b[1]) } : null;
  };
  // Best available source per model: measured at this level, measured 95% scaled, model interval scaled.
  const pick = (points, sources) => {
    for (const [lo, hi, isModel] of sources) {
      const b = band(points, lo, hi);
      if (b) return { ...b, isModel };
    }
    return null;
  };
  const measured = [["bands"], ["band_low", "band_high"]];
  const lp = dates.map((d) => l[d]);
  const ap = dates.map((d) => a[d]);
  const lstmBand = lstm ? pick(lp, measured) : null;
  const arimaBand = arima ? pick(ap, [...measured, ["lower_95", "upper_95", true]]) : null;
  return {
    dates,
    level,
    lstm: lstm ? lp.map((p) => p?.predicted_close) : null,
    arima: arima ? ap.map((p) => p?.predicted_close) : null,
    lstmBand,
    arimaBand,
  };
}

/** Confidence-level picker for a forecast band (the chart's "beam"). */
export function BandLevelSelect({ value, onChange, disabled }) {
  return (
    <label
      className="muted band-level"
      title="Confidence level of the shaded bands: the share of past forecasts (in each model's backtest) whose actual price landed inside the band at that step"
    >
      Band
      <select value={value} onChange={(e) => onChange(Number(e.target.value))} disabled={disabled}>
        {BAND_LEVELS.map((lv) => (
          <option key={lv} value={lv}>{lv}%</option>
        ))}
      </select>
    </label>
  );
}

/**
 * History plus, after it, the LSTM / ARIMA forecast paths and each model's
 * confidence band (the "beam"), one point per forecast day, joined at the last
 * actual point.
 * @param history  [{date, value}] (already cut to the chosen range)
 * @param forecast {dates, level?, lstm?, arima?, lstmBand?: {low, high, isModel?}, arimaBand?: {low, high, isModel?}}
 *   in the same units as `value`, or null to draw the history only
 * @param format   value -> label (axis, tooltip)
 * @param area     fill under the history line (portfolio index style)
 */
export default function ForecastChart({ history, forecast, format, historyName = "Price", area = false, height = 260 }) {
  const has = (k) => !!forecast?.[k]?.length;
  const hasBand = (k) => !!forecast?.[k]?.low?.length;
  const data = useMemo(() => {
    if (!history.length) return [];
    const rows = history.map((h) => ({ date: h.date, value: h.value }));
    if (!forecast) return rows;
    const last = rows[rows.length - 1];
    rows[rows.length - 1] = {
      ...last,
      lstm: has("lstm") ? last.value : undefined,
      arima: has("arima") ? last.value : undefined,
      lstmBand: hasBand("lstmBand") ? [last.value, last.value] : undefined,
      arimaBand: hasBand("arimaBand") ? [last.value, last.value] : undefined,
    };
    const band = (k, i) => (hasBand(k) && forecast[k].low[i] != null ? [forecast[k].low[i], forecast[k].high[i]] : undefined);
    forecast.dates.forEach((date, i) => {
      if (date <= last.date) return;
      rows.push({
        date,
        lstm: forecast.lstm?.[i],
        arima: forecast.arima?.[i],
        lstmBand: band("lstmBand", i),
        arimaBand: band("arimaBand", i),
      });
    });
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, forecast]);
  const lastDate = history[history.length - 1]?.date;
  const level = forecast?.level ?? DEFAULT_BAND_LEVEL;
  const lstmBandName = bandName("LSTM", level, forecast?.lstmBand?.isModel);
  const arimaBandName = bandName("ARIMA", level, forecast?.arimaBand?.isModel);

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
          formatter={(value, name) => (Array.isArray(value) ? [`${format(value[0])} – ${format(value[1])}`, name] : [format(value), name])}
        />
        {forecast && <Legend wrapperStyle={{ fontSize: "0.78rem" }} />}
        {hasBand("lstmBand") && (
          <Area dataKey="lstmBand" name={lstmBandName} type="linear" stroke={FORECAST_COLORS.lstm} strokeOpacity={0.35} strokeWidth={1} fill={FORECAST_COLORS.lstm} fillOpacity={0.1} isAnimationActive={false} connectNulls />
        )}
        {hasBand("arimaBand") && (
          <Area dataKey="arimaBand" name={arimaBandName} type="linear" stroke={FORECAST_COLORS.arima} strokeOpacity={0.35} strokeWidth={1} fill={FORECAST_COLORS.arima} fillOpacity={0.1} isAnimationActive={false} connectNulls />
        )}
        {area ? (
          <Area dataKey="value" name={historyName} stroke={FORECAST_COLORS.history} strokeWidth={2.5} fill="url(#historyFill)" dot={false} isAnimationActive={false} />
        ) : (
          <Line dataKey="value" name={historyName} stroke={FORECAST_COLORS.history} strokeWidth={2.5} dot={false} isAnimationActive={false} />
        )}
        {has("lstm") && <Line dataKey="lstm" name="LSTM forecast" type="linear" stroke={FORECAST_COLORS.lstm} strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} connectNulls />}
        {has("arima") && <Line dataKey="arima" name="ARIMA forecast" type="linear" stroke={FORECAST_COLORS.arima} strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} connectNulls />}
        {forecast && lastDate && (
          <ReferenceLine x={lastDate} stroke="var(--color-text-secondary)" strokeDasharray="3 3" label={{ value: "Forecast →", position: "insideTopRight", fontSize: 11, fill: "var(--color-text-secondary)" }} />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
