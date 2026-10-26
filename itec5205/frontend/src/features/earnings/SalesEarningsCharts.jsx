import { useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { tooltipProps } from "../../utils/chartTheme";

// Series colors, validated (dataviz validate_palette.js) against each mode's
// card surface: first series = the app's chart blue, second = orange.
const COLORS = {
  light: { main: "#2563eb", second: "#eb6834", grid: "#e2e8f0", tick: "#64748b" },
  dark: { main: "#3b82f6", second: "#d95926", grid: "#1f2a44", tick: "#94a3b8" },
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
const pctText = (v) => (v == null ? "–" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`);
const pctColor = (v) => (v == null || v === 0 ? "var(--color-text-primary)" : v > 0 ? "#16a34a" : "#dc2626");

// Growth axes stop at +300% so one tiny base (e.g. EPS near zero) can't
// flatten everything else; tooltips still show the real value.
const CLIP = 3;
const clip = (v) => (v == null ? null : Math.max(-1, Math.min(CLIP, v)));

// "Q2 2026" / "FY2025" from a period end; fiscal quarters are named by the
// calendar quarter they end in.
function periodLabel(end, freq) {
  const [y, m] = end.split("-").map(Number);
  return freq === "annual" ? `FY${y}` : `Q${Math.ceil(m / 3)} ${y}`;
}

// Change vs the period `back` places earlier (stored as `<key>_change`).
function withChange(rows, key, back) {
  return rows.map((r, i) => {
    const prev = rows[i - back]?.[key];
    const change = r[key] != null && prev ? (r[key] - prev) / Math.abs(prev) : null;
    return { ...r, [`${key}_change`]: change };
  });
}

function periods(statements, freq, back) {
  const list = (statements || []).filter((s) => s.freq === freq).map((s) => ({ ...s, label: periodLabel(s.period_end, freq) }));
  return withChange(withChange(list, "revenue", back), "net_income", back);
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
      {change != null && <div style={{ color: pctColor(change) }}>{pctText(change)} vs a year earlier</div>}
    </div>
  );
}

function GrowthTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={tooltipProps.contentStyle}>
      <div style={tooltipProps.labelStyle}>{label}</div>
      {payload.map((p) => {
        const value = p.payload[`${p.dataKey}_raw`];
        return (
          <div key={p.dataKey} style={{ color: "var(--color-text-primary)" }}>
            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: p.color, marginRight: 6 }} />
            {p.name}: <strong style={{ color: pctColor(value) }}>{pctText(value)}</strong>
          </div>
        );
      })}
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

function GrowthTile({ label, value, note }) {
  return (
    <div className="stat-tile" style={{ display: "block" }}>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color: pctColor(value) }}>{pctText(value)}</div>
      <div className="muted" style={{ fontSize: "0.72rem" }}>{note}</div>
    </div>
  );
}

function Toggle({ options, value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {options.map(([key, label]) => (
        <button key={key} className={value === key ? "btn" : "btn secondary"} style={{ padding: "4px 10px", fontSize: "0.78rem" }} onClick={() => onChange(key)}>
          {label}
        </button>
      ))}
    </div>
  );
}

const xAxisProps = (c) => ({ tick: { fontSize: 11, fill: c.tick }, tickLine: false, axisLine: { stroke: c.grid } });
const yAxisProps = (c) => ({ tick: { fontSize: 11, fill: c.tick }, tickLine: false, axisLine: false, width: 52 });
const fmtAxisPct = (v) => `${Math.round(v * 100)}%`;

/** Company page: sales and net income per quarter / year as amounts or
 * growth, growth tiles, and the whole EPS history (amount or growth). */
export default function SalesEarningsCharts({ statements, reports, stats }) {
  const dark = useSelector((s) => s.theme.darkMode);
  const c = COLORS[dark ? "dark" : "light"];
  const [freq, setFreq] = useState("quarterly");
  const [view, setView] = useState("amounts"); // "amounts" | "growth"
  const [basis, setBasis] = useState("year"); // growth vs a "year" earlier | the "previous" period

  const yearBack = freq === "quarterly" ? 4 : 1;
  const rows = useMemo(() => periods(statements, freq, yearBack), [statements, freq, yearBack]);
  const growthRows = useMemo(
    () =>
      periods(statements, freq, basis === "year" ? yearBack : 1)
        .filter((r) => r.revenue_change != null || r.net_income_change != null)
        .map((r) => ({
          label: r.label,
          sales: clip(r.revenue_change), sales_raw: r.revenue_change,
          earnings: clip(r.net_income_change), earnings_raw: r.net_income_change,
        })),
    [statements, freq, basis, yearBack]
  );
  const lastYear = useMemo(() => periods(statements, "annual", 1).at(-1) || null, [statements]);

  // Reported EPS vs the same quarter a year earlier (4 releases back), only
  // where that earlier EPS was positive (growth from a loss isn't a %).
  const eps = useMemo(() => {
    const list = [...(reports || [])].filter((r) => r.eps_reported != null || r.eps_estimate != null).reverse();
    const reported = list.filter((r) => r.eps_reported != null);
    const growth = new Map();
    reported.forEach((r, i) => {
      const prev = reported[i - 4]?.eps_reported;
      if (prev > 0) growth.set(r.date, (r.eps_reported - prev) / prev);
    });
    return list.map((r) => {
      const g = growth.has(r.date) ? growth.get(r.date) : null;
      return { date: r.date, reported: r.eps_reported, estimate: r.eps_estimate, eps_growth: clip(g), eps_growth_raw: g };
    });
  }, [reports]);
  const epsGrowth = eps.filter((e) => e.eps_growth != null);

  const span = rows.length ? `${rows[0].label} – ${rows[rows.length - 1].label}` : "";
  const unit = freq === "quarterly" ? "quarter" : "year";
  const basisText = basis === "year" ? (freq === "quarterly" ? "vs the same quarter a year earlier" : "vs the year before") : `vs the previous ${unit}`;
  const fy = lastYear ? `FY${lastYear.period_end.slice(0, 4)} vs the year before` : "last fiscal year";

  return (
    <div style={{ marginBottom: 16 }}>
      <div className="tile-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", marginBottom: 12 }}>
        <GrowthTile label="Sales growth" value={stats?.revenue_growth_yoy_q} note="last quarter vs a year earlier" />
        <GrowthTile label="Earnings growth" value={stats?.earnings_growth_yoy_q} note="last quarter vs a year earlier" />
        <GrowthTile label="Sales growth" value={lastYear?.revenue_change} note={fy} />
        <GrowthTile label="Earnings growth" value={lastYear?.net_income_change} note={fy} />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
        <div style={{ fontWeight: 600 }}>Sales and earnings</div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Toggle options={[["amounts", "Amounts"], ["growth", "Growth"]]} value={view} onChange={setView} />
          {view === "growth" && <Toggle options={[["year", "vs a year earlier"], ["previous", "vs previous period"]]} value={basis} onChange={setBasis} />}
          <Toggle options={[["quarterly", "Quarterly"], ["annual", "Annual"]]} value={freq} onChange={setFreq} />
        </div>
      </div>

      {view === "amounts" ? (
        <div className="sales-earnings-grid">
          <PeriodBars rows={rows} valueKey="revenue" title="Sales (revenue)" subtitle={span} c={c} />
          <PeriodBars rows={rows} valueKey="net_income" title="Earnings (net income)" subtitle={span} c={c} />
        </div>
      ) : (
        <div>
          <div style={{ fontWeight: 600 }}>Sales growth and earnings growth</div>
          <div className="muted" style={{ fontSize: "0.78rem", marginBottom: 4 }}>Each {unit} {basisText}</div>
          {growthRows.length === 0 ? (
            <p className="muted">
              Not enough stored periods yet
              {basis === "year" && freq === "quarterly" ? " (a year-earlier quarter needs 5 quarters). Try “vs previous period” or Annual." : "."}
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={growthRows} margin={{ top: 8, right: 8, left: 4, bottom: 0 }} barCategoryGap="25%" barGap={2}>
                <CartesianGrid vertical={false} stroke={c.grid} strokeDasharray="3 3" />
                <XAxis dataKey="label" {...xAxisProps(c)} />
                <YAxis tickFormatter={fmtAxisPct} {...yAxisProps(c)} />
                <ReferenceLine y={0} stroke={c.tick} />
                <Tooltip cursor={{ fill: "rgba(148,163,184,0.12)" }} content={<GrowthTooltip />} />
                <Legend wrapperStyle={{ fontSize: "0.78rem" }} />
                <Bar dataKey="sales" name="Sales growth" fill={c.main} radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={false} />
                <Bar dataKey="earnings" name="Earnings growth" fill={c.second} radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      )}
      <p className="muted" style={{ margin: "4px 0 12px", fontSize: "0.78rem" }}>
        Yahoo Finance gives the last 5 quarters and 4 fiscal years; every import keeps them, so the history grows from here.
        {view === "growth" ? " The axis stops at +300%; hover for the real value." : ""}
      </p>

      {view === "amounts" && eps.length > 1 && (
        <div>
          <div style={{ fontWeight: 600 }}>Earnings per share, every quarter</div>
          <div className="muted" style={{ fontSize: "0.78rem", marginBottom: 4 }}>
            {eps.length} releases, {eps[0].date.slice(0, 4)} – {eps[eps.length - 1].date.slice(0, 4)}
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={eps} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={c.grid} strokeDasharray="3 3" />
              <XAxis dataKey="date" tickFormatter={(d) => d.slice(0, 4)} minTickGap={40} {...xAxisProps(c)} />
              <YAxis tickFormatter={(v) => `$${v}`} {...yAxisProps(c)} />
              <ReferenceLine y={0} stroke={c.tick} />
              <Tooltip {...tooltipProps} formatter={(v, name) => [fmtEps(v), name]} />
              <Legend wrapperStyle={{ fontSize: "0.78rem" }} />
              <Line type="linear" dataKey="reported" name="Reported EPS" stroke={c.main} strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls isAnimationActive={false} />
              <Line type="linear" dataKey="estimate" name="Analysts' estimate" stroke={c.second} strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 4 }} connectNulls isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {view === "growth" && epsGrowth.length > 1 && (
        <div>
          <div style={{ fontWeight: 600 }}>Earnings per share growth, every quarter</div>
          <div className="muted" style={{ fontSize: "0.78rem", marginBottom: 4 }}>
            Reported EPS vs the same quarter a year earlier, {epsGrowth[0].date.slice(0, 4)} – {epsGrowth[epsGrowth.length - 1].date.slice(0, 4)}; left out where the earlier quarter was a loss
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={epsGrowth} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={c.grid} strokeDasharray="3 3" />
              <XAxis dataKey="date" tickFormatter={(d) => d.slice(0, 4)} minTickGap={40} {...xAxisProps(c)} />
              <YAxis tickFormatter={fmtAxisPct} {...yAxisProps(c)} />
              <ReferenceLine y={0} stroke={c.tick} />
              <Tooltip content={<GrowthTooltip />} />
              <Line type="linear" dataKey="eps_growth" name="EPS growth" stroke={c.main} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
