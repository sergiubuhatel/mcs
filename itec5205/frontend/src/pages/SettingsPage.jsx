import { useEffect, useMemo, useState } from "react";
import { BAND_LEVELS } from "../components/ForecastChart";
import { useDispatch } from "react-redux";
import { toast } from "react-toastify";
import { apiClient } from "../api/client";
import { PageHeader } from "../components/PageParts";
import {
  CandlestickIcon,
  WorkflowIcon,
  DatabaseIcon,
  GearIcon,
  PieChartIcon,
  SaveIcon,
  SearchIcon,
} from "../layout/icons";
import { MODEL_RULES, TRAINING_UNITS } from "../features/policies/criteriaConfig";
import { EXISTING_MODES, UNIVERSES } from "../features/dataImport/ImportControls";
import { DEFAULT_SETTINGS, getSavedSettings, getSettings, saveSettings } from "../features/settings/settings";
import { INTERVALS } from "../utils/dateRanges";

const opts = (list) => list.map((v) => (typeof v === "object" ? v : { value: v, label: String(v) }));
const UNITS = opts([{ value: "M", label: "Million ($M)" }, { value: "B", label: "Billion ($B)" }, { value: "T", label: "Trillion ($T)" }]);
const TREND_WINDOWS = opts([
  { value: 63, label: "3 months" },
  { value: 126, label: "6 months" },
  { value: 252, label: "1 year" },
  { value: 504, label: "2 years" },
  { value: 756, label: "3 years" },
]);
const SORT_COLUMNS = opts([
  { value: "market_cap", label: "Market cap" },
  { value: "ticker", label: "Ticker" },
  { value: "name", label: "Company" },
  { value: "signal", label: "Signal" },
  { value: "current_price", label: "Price" },
  { value: "day_change", label: "Change (1D)" },
  { value: "stock_growth_1y", label: "Change (1Y)" },
  { value: "volatility", label: "Volatility (1Y)" },
  { value: "trailing_pe", label: "P/E" },
  { value: "revenue_growth_yoy", label: "Revenue growth" },
  { value: "earnings_growth_yoy_q", label: "EPS growth" },
  { value: "roe", label: "ROE" },
  { value: "roa", label: "ROA" },
  { value: "debt_to_equity", label: "Debt/Equity" },
  { value: "free_cash_flow", label: "Free cash flow" },
]);

// One card per section; `where` (help text) says which page uses the value.
const SECTIONS = [
  {
    key: "general",
    title: "General Defaults",
    icon: GearIcon,
    color: "#3b82f6",
    text: "Charts and lists shared by several pages.",
    fields: [
      { key: "chart_range", label: "Price chart range", type: "select", options: opts(INTERVALS.map((i) => i.key)), help: "Initial interval of the company and portfolio detail charts." },
      { key: "list_page_size", label: "Rows per list page", type: "select", options: opts([5, 10, 20, 50]), number: true, help: "Page size of the Policies, Stock Pools and My Portfolios grids." },
      { key: "next_days", label: "Next-days forecast rows", type: "number", min: 1, max: 60, help: "How many daily steps the 'next days' forecast tables show at first." },
    ],
  },
  {
    key: "data",
    title: "Data Defaults",
    icon: DatabaseIcon,
    color: "#10b981",
    text: "The Market Data import form and new Data Filters.",
    fields: [
      { key: "universe", label: "Companies to import", type: "select", options: opts(Object.entries(UNIVERSES).map(([value, u]) => ({ value, label: u.option }))), help: "Index list the import form starts with (S&P 500 unless you change it)." },
      { key: "existing", label: "Companies already imported", type: "select", options: opts(EXISTING_MODES.map(({ value, label }) => ({ value, label }))), help: "Skip them, catch them up when their prices are behind, or re-import them." },
      { key: "years", label: "History since", type: "select", options: opts([1, 2, 5, 10, 15, 20].map((y) => ({ value: y, label: `${y} year${y === 1 ? "" : "s"} ago` }))), number: true, help: "How far back price history starts (same choices as the import form)." },
      { key: "import_history", label: "Import price history", type: "toggle", help: "Daily prices from Yahoo Finance." },
      { key: "import_statistics", label: "Import statistics", type: "toggle", help: "Fundamentals: valuation, profitability, debt, growth." },
      { key: "import_calculated_stats", label: "Calculated statistics", type: "toggle", help: "1-year change and volatility computed from the stored prices." },
    ],
  },
  {
    key: "screening",
    title: "Screening Defaults",
    icon: SearchIcon,
    color: "#8b5cf6",
    text: "How the Stock Screener opens.",
    fields: [
      { key: "start_criteria_id", label: "Start from a saved search", type: "criteria", help: "Open the Stock Screener with this Screening Criteria already filled in (None = all companies)." },
      { key: "page_size", label: "Rows per page", type: "select", options: opts([25, 50, 100, 250, 600, 1000]), number: true, help: "Results grid page size." },
      { key: "sort_by", label: "Sort by", type: "select", options: SORT_COLUMNS, help: "Results grid sort column." },
      { key: "sort_dir", label: "Sort direction", type: "select", options: opts([{ value: "desc", label: "Descending ↓" }, { value: "asc", label: "Ascending ↑" }]), help: "Results grid sort direction." },
      { key: "market_cap_unit", label: "Market cap unit", type: "select", options: UNITS, help: "Unit the market cap min / max are typed in." },
      { key: "fcf_unit", label: "Free cash flow unit", type: "select", options: UNITS, help: "Unit the free cash flow min / max are typed in." },
    ],
  },
  {
    key: "forecast",
    title: "Forecast Defaults",
    icon: CandlestickIcon,
    color: "#f59e0b",
    text: "LSTM / ARIMA runs, the Price Forecasts page and new Forecast Settings.",
    fields: [
      { key: "training_days", label: "Training days", type: "number", min: 120, suffix: "days", help: "Most recent trading days both models train on (screener, pools, company page, Price Forecasts)." },
      { key: "lstm_epochs", label: "LSTM max epochs", type: "number", min: 1, help: "Upper bound on LSTM epochs (early stopping may end sooner)." },
      { key: "horizon", label: "Signal horizon", type: "select", options: opts(["1M", "2M", "3M", "4M"]), help: "Horizon the Price Forecasts page rates signals at first." },
      { key: "band_level", label: "Forecast band confidence", type: "select", options: opts(BAND_LEVELS.map((lv) => ({ value: lv, label: `${lv}%` }))), number: true, help: "Initial confidence level of the shaded forecast bands on the company, portfolio and Price Forecasts charts (each chart can still change it)." },
      { key: "chart_range", label: "Forecast chart range", type: "select", options: opts(["1M", "3M", "6M", "1Y", "ALL"]), help: "Initial history shown on the Price Forecasts chart." },
      { key: "quick_tickers", label: "Quick-pick tickers", type: "text", help: "Shown on Price Forecasts before anything has been forecast (comma-separated)." },
      { key: "models", label: "Pass rule", type: "select", options: opts(Object.entries(MODEL_RULES).map(([value, label]) => ({ value, label }))), help: "Which forecasts a company must pass in a new Forecast Settings." },
      { key: "training_value", label: "Training window", type: "number", min: 1, unitKey: "training_unit", unitOptions: opts(TRAINING_UNITS), help: "History a new Forecast Settings trains on." },
      { key: "min_change_pct", label: "Minimum rise", type: "number", blank: "no minimum", suffix: "%", help: "Smallest forecast rise that counts as passing (blank = any rise)." },
      { key: "reuse_forecasts", label: "Reuse recent forecasts", type: "toggle", help: "Policy runs reuse forecasts already trained on the same data instead of retraining." },
    ],
  },
  {
    key: "portfolio",
    title: "Portfolio Defaults",
    icon: PieChartIcon,
    color: "#ef4444",
    text: "The RL builder on Stock Pools and new Portfolio Constraints.",
    fields: [
      { key: "mode", label: "Companies to use", type: "select", options: opts([{ value: "full", label: "Whole pool" }, { value: "subset", label: "Best subset (trend)" }, { value: "strong", label: "Strong signals only" }]), help: "Strong signals only applies to the pool RL builder; new Portfolio Constraints use Whole pool instead." },
      { key: "trend_window_days", label: "Trend window", type: "select", options: TREND_WINDOWS, number: true, help: "How far back the straight-line trend is checked (Best subset)." },
      { key: "risk_aversion", label: "Risk aversion", type: "number", min: 0, step: 0.1, help: "Higher = more conservative allocation." },
      { key: "timesteps", label: "Training timesteps", type: "number", min: 1000, step: 1000, help: "PPO training steps; more train longer." },
      { key: "max_volatility_pct", label: "Max volatility", type: "number", blank: "no limit", suffix: "%", help: "Annual volatility ceiling (blank = none)." },
      { key: "min_return_pct", label: "Min annual return", type: "number", blank: "no minimum", suffix: "%", help: "Past-year return floor (blank = none)." },
      { key: "max_weight_range_pct", label: "Max weight range", type: "number", blank: "no cap", help: "How much bigger the largest holding may be than the smallest (blank = none)." },
      {
        key: "weight_range_basis",
        label: "Weight range relative to",
        type: "select",
        options: opts([
          { value: "smallest", label: "% of smallest" },
          { value: "largest", label: "% of largest" },
          { value: "points", label: "percentage points" },
        ]),
        help: "% of smallest: 50 = largest ≤ 1.5× smallest. % of largest: 50 = smallest ≥ half the largest. Points: 10 = at most 10 points apart.",
      },
      { key: "order_allow_sell", label: "Order Calculator: allow selling", type: "toggle", help: "Rebalance (sell what is above target); off = buy only." },
      { key: "order_spend_leftover", label: "Order Calculator: invest leftover cash", type: "toggle", help: "Keep buying single shares until no target stock fits the cash left." },
      { key: "order_fractional", label: "Order Calculator: fractional shares", type: "toggle", help: "Quantities with up to 4 decimals." },
      { key: "min_companies", label: "Min companies", type: "number", blank: "auto", min: 1, help: "Fewest holdings (blank = auto)." },
      { key: "max_companies", label: "Max companies", type: "number", blank: "auto", min: 1, help: "Most holdings (blank = auto)." },
    ],
  },
  {
    key: "automation",
    title: "Automation Defaults",
    icon: WorkflowIcon,
    color: "#14b8a6",
    text: "Policies and how pages behave between visits.",
    fields: [
      { key: "refresh_seconds", label: "Live progress refresh", type: "number", min: 1, max: 60, suffix: "s", help: "How often the Policies grid and run details refresh while a policy is running." },
      { key: "open_run_panel", label: "Open run details after Run", type: "toggle", help: "Show the step-by-step run panel as soon as a policy starts." },
      { key: "remember_screener", label: "Remember screener search", type: "toggle", help: "Reopen the Stock Screener with the last applied search (instead of the screening defaults) in this browser." },
      { key: "remember_columns", label: "Remember grid columns", type: "toggle", help: "Keep each grid's column order and hidden columns in this browser; off = always the default columns." },
      { key: "show_tips", label: "Show help panels", type: "toggle", help: "The About and Quick tips panels at the bottom of the list pages." },
    ],
  },
];

function Help({ text }) {
  return (
    <span className="help-dot" title={text} aria-label={text} role="img">?</span>
  );
}

function Toggle({ checked, onChange, id }) {
  return (
    <label className="toggle" htmlFor={id}>
      <input id={id} type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track"><span className="toggle-thumb" /></span>
      <span className="muted">{checked ? "Enabled" : "Disabled"}</span>
    </label>
  );
}

// Saved form values -> API payload: numbers as numbers, blanks kept blank.
function toPayload(form) {
  const out = {};
  for (const section of SECTIONS) {
    out[section.key] = {};
    for (const f of section.fields) {
      const v = form[section.key][f.key];
      out[section.key][f.key] = (f.type === "number" || f.number) && v !== "" ? Number(v) : v;
      if (f.unitKey) out[section.key][f.unitKey] = form[section.key][f.unitKey];
    }
  }
  return out;
}

function validate(form) {
  for (const section of SECTIONS) {
    for (const f of section.fields) {
      if (f.type !== "number") continue;
      const v = form[section.key][f.key];
      if (v === "" || v == null) {
        if (f.blank) continue;
        return `${section.title}: ${f.label} is required`;
      }
      const n = Number(v);
      if (Number.isNaN(n)) return `${section.title}: ${f.label} must be a number`;
      if (f.min != null && n < f.min) return `${section.title}: ${f.label} must be at least ${f.min}`;
      if (f.max != null && n > f.max) return `${section.title}: ${f.label} must be at most ${f.max}`;
    }
  }
  return null;
}

export default function SettingsPage() {
  const dispatch = useDispatch();
  const [form, setForm] = useState(() => structuredClone(getSettings()));
  const [baseline, setBaseline] = useState(() => JSON.stringify(getSettings()));
  const [screens, setScreens] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    apiClient.get("/api/criteria/screen").then((r) => setScreens(r.data.criteria)).catch(() => {});
  }, []);

  const dirty = JSON.stringify(form) !== baseline;
  const customized = useMemo(() => Object.values(getSavedSettings()).reduce((n, s) => n + Object.keys(s || {}).length, 0), [baseline]);
  const set = (section, key, value) => setForm((f) => ({ ...f, [section]: { ...f[section], [key]: value } }));

  const save = async () => {
    const problem = validate(form);
    setError(problem);
    if (problem) return;
    setSaving(true);
    try {
      const next = await saveSettings(dispatch, toPayload(form));
      setForm(structuredClone(next));
      setBaseline(JSON.stringify(next));
      toast.success("Settings saved — pages open with these values from now on");
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  const control = (section, f) => {
    const id = `set-${section.key}-${f.key}`;
    const value = form[section.key][f.key];
    if (f.type === "toggle") return <Toggle id={id} checked={value} onChange={(v) => set(section.key, f.key, v)} />;
    if (f.type === "select")
      return (
        <select id={id} value={value} onChange={(e) => set(section.key, f.key, f.number ? Number(e.target.value) : e.target.value)}>
          {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    if (f.type === "criteria")
      return (
        <select id={id} value={value} onChange={(e) => set(section.key, f.key, e.target.value)}>
          <option value="">None — all companies</option>
          {screens.map((c) => <option key={c._key} value={c._key}>{c.name}</option>)}
          {value && !screens.some((c) => c._key === value) && <option value={value}>(deleted criteria)</option>}
        </select>
      );
    const input = (
      <input
        id={id}
        type={f.type === "number" ? "number" : "text"}
        min={f.min}
        max={f.max}
        step={f.step}
        value={value ?? ""}
        placeholder={f.blank}
        onChange={(e) => set(section.key, f.key, e.target.value)}
      />
    );
    if (f.unitKey)
      return (
        <div className="setting-pair">
          {input}
          <select aria-label={`${f.label} unit`} value={form[section.key][f.unitKey]} onChange={(e) => set(section.key, f.unitKey, e.target.value)}>
            {f.unitOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      );
    return f.suffix ? <div className="setting-suffix">{input}<span>{f.suffix}</span></div> : input;
  };

  return (
    <div>
      <div className="card header-card">
        <PageHeader
          icon={GearIcon}
          color="#3b82f6"
          title="Settings"
          description="Configure the initial values every page opens with. Saved for everyone using this app."
          actions={
            <div className="toolbar">
              <button className="btn secondary" onClick={() => setForm(structuredClone(DEFAULT_SETTINGS))} title="Fill the form with the built-in defaults (Save to keep them)">
                Reset to Defaults
              </button>
              <button className="btn" onClick={save} disabled={saving || !dirty} title={dirty ? "Save the changes" : "No changes to save"}>
                <SaveIcon width={16} height={16} /> {saving ? "Saving…" : "Save Settings"}
              </button>
            </div>
          }
        />
      </div>

      <div className="info-banner">
        <span className="info-banner-icon">i</span>
        <span>
          The initial values of the Data, Screening, Forecasting, Portfolio and Automation pages and of new criteria —
          saved criteria and policies are not changed.
          {customized > 0 ? ` ${customized} value${customized === 1 ? "" : "s"} customized` : " All built-in defaults"}; a dot marks a changed value.
        </span>
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}

      <div className="settings-grid">
        {SECTIONS.map((section) => {
          const Icon = section.icon;
          return (
            <section key={section.key} className="card settings-card">
              <div className="card-header settings-card-header">
                <div className="icon-badge" style={{ background: `${section.color}22`, color: section.color, width: 42, height: 42, borderRadius: 11 }}>
                  <Icon width={22} height={22} />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <h3 style={{ margin: 0 }}>{section.title}</h3>
                  <p className="muted" style={{ margin: 0 }}>{section.text}</p>
                </div>
              </div>
              <div className="settings-rows">
                {section.fields.map((f) => {
                  const changed =
                    String(form[section.key][f.key]) !== String(DEFAULT_SETTINGS[section.key][f.key]) ||
                    (f.unitKey && form[section.key][f.unitKey] !== DEFAULT_SETTINGS[section.key][f.unitKey]);
                  return (
                    <div key={f.key} className="setting-row">
                      <label htmlFor={`set-${section.key}-${f.key}`}>
                        {f.label}
                        {changed && <span className="changed-dot" title="Differs from the built-in default" />}
                      </label>
                      <div className="setting-control">{control(section, f)}</div>
                      <Help text={f.help} />
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
