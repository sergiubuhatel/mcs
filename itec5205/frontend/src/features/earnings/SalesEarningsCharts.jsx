import { useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { tooltipProps } from "../../utils/chartTheme";

// Series colors, validated (dataviz validate_palette.js) against each mode's
// card surface: reported = the app's chart blue, estimate = orange.
const COLORS = {
  light: { main: "#2563eb", estimate: "#eb6834", grid: "#e2e8f0", tick: "#64748b" },
  dark: { main: "#3b82f6", estimate: "#d95926", grid: "#1f2a44", tick: "#94a3b8" },
};

function fmtMoney(v) {
  if (v == null) return "–";
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  return `${sign}$${a.toFixed(0)}`;
}
// Axis ticks: at most one decimal, trailing zero dropped ($1.5B, $2B).
function fmtAxisMoney(v) {
  const a = Math.abs(v);
  const [div, unit] = a >= 1e12 ? [1e12, "T"] : a >= 1e9 ? [1e9, "B"] : a >= 1e6 ? [1e6, "M"] : [1, ""];
  return `${v < 0 ? "-" : ""}$${Number((a / div).toFixed(1))}${unit}`;
}
const fmtEps = (v) => (v == null ? "–" : `$${Number(v).toFixed(2)}`);

// "Q2 2026" / "2025" from a period end; fiscal quarters are named by the
// calendar quarter they end in.
function periodLabel(end, freq) {
  const [y, m] = end.split("-").map(Number);
  return freq === "annual" ? `FY${y}` : `Q${Math.ceil(m / 3)} ${y}`;
}

// Change vs the same period a year earlier (4 quarters / 1 year back).
function withChange(rows, key, back) {
  return rows.map((r, i) => {
    const prev = rows[i - back]?.[key];
    const change = r[key] != null && prev ? (r[key] - prev) / Math.abs(prev) : null;
    return { ...r, [`${key}_change`]: change };
  });
}

function PeriodTooltip({ active, payload, label, valueKey, title }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const change = row[`${valueKey}_change`];
  return (
    <div style={tooltipProps.contentStyle}>
      <div style={tooltipProps.labelStyle}>{label} · ended {row.period_end}</div>
      <div style={{ color: "var(--color-text-primary)" }}>
        {title}: <strong>{fmtMoney(row[valueKey])}</strong>
      </div>
      {change != null && (
        <div style={{ color: change > 0 ? "#16a34a" : change < 0 ? "#dc2626" : "var(--color-text-primary)" }}>
          {change > 0 ? "+" : ""}{(change * 100).toFixed(1)}% vs a year earlier
        </div>
      )}
    </div>
  );
}

function PeriodBars({ rows, valueKey, title, subtitle, c }) {
  const has = rows.some((r) => r[valueKey] != null);
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontWeight: 600 }}>{title}</div>
      <div className="muted" style={{ fontSize: "0.78rem", marginBottom: 4 }}>{subtitle}</div>
      {!has ? (
        <p className="muted">Yahoo has no figures for this company.</p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={rows} margin={{ top: 8, right: 8, left: 4, bottom: 0 }} barCategoryGap="22%">
            <CartesianGrid vertical={false} stroke={c.grid} strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: c.tick }} tickLine={false} axisLine={{ stroke: c.grid }} />
            <YAxis tickFormatter={fmtAxisMoney} tick={{ fontSize: 11, fill: c.tick }} tickLine={false} axisLine={false} width={62} />
            <ReferenceLine y={0} stroke={c.tick} />
            <Tooltip cursor={{ fill: "rgba(148,163,184,0.12)" }} content={<PeriodTooltip valueKey={valueKey} title={title} />} />
            <Bar dataKey={valueKey} fill={c.main} radius={[4, 4, 0, 0]} maxBarSize={56} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

/** Company page: sales and net income per quarter / year, plus the whole
 * reported-vs-estimated EPS history from the earnings releases. */
export default function SalesEarningsCharts({ statements, reports }) {
  const dark = useSelector((s) => s.theme.darkMode);
  const c = COLORS[dark ? "dark" : "light"];
  const [freq, setFreq] = useState("quarterly");

  const rows = useMemo(() => {
    const list = (statements || [])
      .filter((s) => s.freq === freq)
      .map((s) => ({ ...s, label: periodLabel(s.period_end, freq) }));
    const back = freq === "quarterly" ? 4 : 1;
    return withChange(withChange(list, "revenue", back), "net_income", back);
  }, [statements, freq]);

  const eps = useMemo(
    () =>
      [...(reports || [])]
        .filter((r) => r.eps_reported != null || r.eps_estimate != null)
        .reverse()
        .map((r) => ({ date: r.date, reported: r.eps_reported, estimate: r.eps_estimate })),
    [reports]
  );

  const span = rows.length ? `${rows[0].label} – ${rows[rows.length - 1].label}` : "";
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
        <div style={{ fontWeight: 600 }}>Sales and earnings</div>
        <div style={{ display: "flex", gap: 4 }}>
          {[["quarterly", "Quarterly"], ["annual", "Annual"]].map(([key, label]) => (
            <button key={key} className={freq === key ? "btn" : "btn secondary"} style={{ padding: "4px 10px", fontSize: "0.78rem" }} onClick={() => setFreq(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="sales-earnings-grid">
        <PeriodBars rows={rows} valueKey="revenue" title="Sales (revenue)" subtitle={span} c={c} />
        <PeriodBars rows={rows} valueKey="net_income" title="Earnings (net income)" subtitle={span} c={c} />
      </div>
      <p className="muted" style={{ margin: "4px 0 12px", fontSize: "0.78rem" }}>
        Yahoo Finance gives the last 5 quarters and 4 fiscal years; every import keeps them, so the history grows from here.
      </p>

      {eps.length > 1 && (
        <div>
          <div style={{ fontWeight: 600 }}>Earnings per share, every quarter</div>
          <div className="muted" style={{ fontSize: "0.78rem", marginBottom: 4 }}>
            {eps.length} releases, {eps[0].date.slice(0, 4)} – {eps[eps.length - 1].date.slice(0, 4)}
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={eps} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={c.grid} strokeDasharray="3 3" />
              <XAxis dataKey="date" tickFormatter={(d) => d.slice(0, 4)} minTickGap={40} tick={{ fontSize: 11, fill: c.tick }} tickLine={false} axisLine={{ stroke: c.grid }} />
              <YAxis tickFormatter={(v) => `$${v}`} tick={{ fontSize: 11, fill: c.tick }} tickLine={false} axisLine={false} width={52} />
              <ReferenceLine y={0} stroke={c.tick} />
              <Tooltip {...tooltipProps} formatter={(v, name) => [fmtEps(v), name]} />
              <Legend wrapperStyle={{ fontSize: "0.78rem" }} />
              <Line type="linear" dataKey="reported" name="Reported EPS" stroke={c.main} strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls isAnimationActive={false} />
              <Line type="linear" dataKey="estimate" name="Analysts' estimate" stroke={c.estimate} strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 4 }} connectNulls isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
