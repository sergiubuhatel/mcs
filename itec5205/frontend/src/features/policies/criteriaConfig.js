import { describeFilters } from "../companies/filterFields";
import { defaultImportOptions, existingMode, universeLabel } from "../dataImport/ImportControls";
import { getSettings } from "../settings/settings";

// In run order: a policy imports (data), screens, predicts, then builds the portfolio.
export const KINDS = {
  data: {
    title: "Data Criteria",
    singular: "data criteria",
    optional: true, // a policy without one skips the import and uses the stored data
    noneOption: "— none (don't import, use the stored data) —",
    noneHint: "Without one, the run screens and forecasts on the data already imported.",
    noneChip: "No data criteria: the run uses the data already stored",
    skipped: "No data criteria — used the data already stored",
    blurb: "The Yahoo Finance import a policy can run first, so it screens and forecasts on fresh data.",
  },
  screen: { title: "Screening Criteria", singular: "screening criteria", blurb: "The Stock Screener search: which companies a policy starts from." },
  prediction: {
    title: "Prediction Criteria",
    singular: "prediction criteria",
    optional: true, // a policy without one skips forecasting: every screened company goes to the portfolio step
    noneOption: "— none (no forecasts, every screened company goes on) —",
    noneHint: "Without one, the run skips forecasting and builds the portfolio from every screened company.",
    noneChip: "No prediction criteria: every screened company goes to the portfolio step",
    skipped: "No prediction criteria — every screened company went on",
    blurb: "When to forecast (e.g. 3 days, 1 month), how much history to train on, and which forecasts a company must pass.",
  },
  portfolio: {
    title: "Portfolio Criteria",
    singular: "portfolio criteria",
    blurb: "The RL portfolio options: volatility / return limits, company counts and training settings.",
  },
};

export const HORIZON_UNITS = ["days", "weeks", "months", "years"];
export const TRAINING_UNITS = ["days", "months", "years"];
export const MODEL_RULES = {
  both: "LSTM and ARIMA both forecast up",
  either: "LSTM or ARIMA forecasts up",
  lstm: "LSTM forecasts up (ARIMA not run)",
  arima: "ARIMA forecasts up (LSTM not run)",
};

/** What a new criteria starts with: the Settings page's defaults. */
export function criteriaDefaults() {
  const { forecast: f, portfolio: p, screening: s } = getSettings();
  return {
    data: { name: "", description: "", ...defaultImportOptions() },
    screen: {
      name: "",
      description: "",
      filters: { index: "", sector: "", industry: "", q: "", ranges: {}, units: { market_cap: s.market_cap_unit, free_cash_flow: s.fcf_unit } },
    },
    prediction: {
      name: "",
      description: "",
      horizons: [1, 2, 3, 4].map((value) => ({ value, unit: "months" })),
      training: { value: f.training_value, unit: f.training_unit },
      models: f.models,
      min_change_pct: f.min_change_pct,
      epochs: f.lstm_epochs,
      reuse_forecasts: f.reuse_forecasts,
    },
    portfolio: {
      name: "",
      description: "",
      // Criteria support full / subset only (no "strong" -- a policy has no signal board).
      mode: p.mode === "subset" ? "subset" : "full",
      trend_window_days: p.trend_window_days,
      risk_aversion: p.risk_aversion,
      timesteps: p.timesteps,
      max_volatility_pct: p.max_volatility_pct,
      min_return_pct: p.min_return_pct,
      max_weight_range_pct: p.max_weight_range_pct,
      weight_range_basis: p.weight_range_basis || "smallest",
      min_companies: p.min_companies,
      max_companies: p.max_companies,
      required_tickers: [],
      excluded_tickers: [],
    },
  };
}

// Max weight range: how much bigger the largest holding may be than the
// smallest, measured against `weight_range_basis` (backend: rl_service.weight_range).
export const WEIGHT_RANGE_HELP = "How much bigger the largest holding may be than the smallest";
export const WEIGHT_RANGE_BASES = {
  smallest: { label: "% of smallest", example: 50 },
  largest: { label: "% of largest", example: 50, max: 100 },
  points: { label: "percentage points", example: 10, max: 100 },
};
const num = (v) => +Number(v).toFixed(2);

/** A worked example of a typed limit, e.g. (50, "smallest") -> "Largest
 * holding at most 1.5× the smallest: smallest 10% → largest ≤ 15%." */
export function weightRangeHint(pct, basis = "smallest") {
  const blank = pct === "" || pct === null || pct === undefined || Number.isNaN(Number(pct)) || Number(pct) < 0;
  const L = blank ? WEIGHT_RANGE_BASES[basis].example : Number(pct);
  if (!blank && L === 0) return "0 = every holding gets the same weight.";
  const text =
    basis === "points"
      ? `Largest minus smallest holding at most ${num(L)} points: smallest 10% → largest ≤ ${num(10 + L)}%.`
      : basis === "largest"
      ? `Smallest holding at least ${num(100 - L)}% of the largest: largest 20% → smallest ≥ ${num(20 * (1 - L / 100))}%.`
      : `Largest holding at most ${num(1 + L / 100)}× the smallest: smallest 10% → largest ≤ ${num(10 * (1 + L / 100))}%.`;
  return blank ? `Blank = no limit. E.g. ${L}: ${text.charAt(0).toLowerCase()}${text.slice(1)}` : text;
}

/** Short form for names and summaries, e.g. "largest ≤ 1.5× smallest". */
export function describeWeightRange(pct, basis = "smallest") {
  const L = Number(pct);
  if (basis === "points") return `weight range ≤ ${num(L)} pts`;
  if (basis === "largest") return `smallest ≥ ${num(100 - L)}% of largest`;
  return `largest ≤ ${num(1 + L / 100)}× smallest`;
}

const plural = (value, unit) => `${value} ${Number(value) === 1 ? unit.replace(/s$/, "") : unit}`;
const isSet = (v) => v !== null && v !== undefined && v !== "";

// Compact horizon label for names: 3D, 1W, 2M, 1Y.
const shortHorizon = (h) => `${h.value}${{ days: "D", weeks: "W", months: "M", years: "Y" }[h.unit]}`;
const RULE_SHORT = { both: "LSTM + ARIMA up", either: "LSTM or ARIMA up", lstm: "LSTM up", arima: "ARIMA up" };

/** A readable default name generated from the criteria's own settings,
 * e.g. "Technology, P/E ≤ 30" or "LSTM + ARIMA up at 1M, 3M · 10Y training". */
export function autoCriteriaName(kind, c) {
  if (kind === "data") {
    const d = describeData(c);
    const full = c.import_history && c.import_statistics && c.import_calculated_stats;
    return `${d.scope} · ${d.years} history${full ? "" : ` · ${d.what}`} · ${EXISTING_SHORT[d.existing]}`;
  }
  if (kind === "screen") return describeFilters(c.filters || {}) || "All companies";
  if (kind === "prediction") {
    const days = (h) => Number(h.value) * { days: 1, weeks: 5, months: 21, years: 252 }[h.unit];
    const points =
      (c.horizons || []).filter((h) => isSet(h.value)).sort((x, y) => days(x) - days(y)).map(shortHorizon).join(", ") || "no points";
    const change = isSet(c.min_change_pct) ? ` ≥ ${c.min_change_pct}%` : "";
    const t = c.training || {};
    const training = t.unit === "days" ? `${t.value} days` : shortHorizon(t);
    return `${RULE_SHORT[c.models] || c.models}${change} at ${points} · ${training} training`;
  }
  const parts = [];
  if (isSet(c.max_volatility_pct)) parts.push(`Vol ≤ ${c.max_volatility_pct}%`);
  if (isSet(c.min_return_pct)) parts.push(`Return ≥ ${c.min_return_pct}%`);
  if (isSet(c.max_weight_range_pct)) {
    const d = describeWeightRange(c.max_weight_range_pct, c.weight_range_basis);
    parts.push(d.charAt(0).toUpperCase() + d.slice(1));
  }
  const min = c.min_companies;
  const max = c.max_companies;
  if (isSet(min) && min === max) parts.push(`${min} companies`);
  else if (isSet(min) && isSet(max)) parts.push(`${min}–${max} companies`);
  else if (isSet(min)) parts.push(`≥ ${min} companies`);
  else if (isSet(max)) parts.push(`≤ ${max} companies`);
  if (c.mode === "subset") parts.push("steady trend");
  const required = tickerList(c.required_tickers);
  if (required.length) parts.push(`must hold ${required.join(", ")}`);
  const excluded = tickerList(c.excluded_tickers);
  if (excluded.length) parts.push(`without ${excluded.join(", ")}`);
  return parts.length ? parts.join(", ") : "Whole pool, no limits";
}

/** Policy name from its criteria's names (screen, prediction, portfolio --
 * the data criteria is left out: it's usually the same for every policy). */
export function autoPolicyName(chosen) {
  return ["screen", "prediction", "portfolio"].map((k) => chosen[k]).filter(Boolean).map((c) => c.name).join(" → ");
}

/** `name`, or "name (2)", "name (3)", ... if another item already has it. */
export function uniqueName(name, items, ownId = null) {
  const taken = new Set(items.filter((i) => i._key !== ownId).map((i) => i.name));
  if (!taken.has(name)) return name;
  let n = 2;
  while (taken.has(`${name} (${n})`)) n += 1;
  return `${name} (${n})`;
}

function describeData(c) {
  const what = [c.import_history && "history", c.import_statistics && "statistics", c.import_calculated_stats && "calculated stats"].filter(Boolean);
  const tickers = Array.isArray(c.tickers) ? c.tickers.join(", ") : c.tickers;
  const label = universeLabel(c);
  const scope = c.scope === "specific" ? tickers || "no tickers" : label.startsWith("All") ? label : `All ${label}`;
  return { scope, years: `${c.years}Y`, what: what.join(" + ") || "nothing", existing: existingMode(c) };
}

const EXISTING_SHORT = { skip: "new only", update: "only missing", reimport: "re-import all" };
const EXISTING_LONG = {
  skip: ", only companies not imported yet",
  update: ", only what's missing",
  reimport: ", always re-fetched",
};

export function describeCriteria(kind, c) {
  if (!c) return "";
  if (kind === "data") {
    const d = describeData(c);
    return `${d.scope}: ${d.what} since ${c.years} year${Number(c.years) === 1 ? "" : "s"} ago${EXISTING_LONG[d.existing]}`;
  }
  if (kind === "screen") return describeFilters(c.filters || {}) || "All companies (no filters)";
  if (kind === "prediction") {
    const points = (c.horizons || []).map((h) => plural(h.value, h.unit)).join(", ");
    const change = c.min_change_pct != null && c.min_change_pct !== "" ? ` by ≥ ${c.min_change_pct}%` : "";
    return `${MODEL_RULES[c.models] || c.models}${change} at ${points}; trained on ${plural(c.training.value, c.training.unit)}`;
  }
  const parts = [c.mode === "subset" ? "Steady upward trend only" : "Whole pool"];
  if (c.max_volatility_pct != null && c.max_volatility_pct !== "") parts.push(`volatility ≤ ${c.max_volatility_pct}%`);
  if (c.min_return_pct != null && c.min_return_pct !== "") parts.push(`annual return ≥ ${c.min_return_pct}%`);
  if (isSet(c.max_weight_range_pct)) parts.push(describeWeightRange(c.max_weight_range_pct, c.weight_range_basis));
  const min = c.min_companies ?? "";
  const max = c.max_companies ?? "";
  if (min !== "" || max !== "") parts.push(`${min === "" ? "auto" : min}–${max === "" ? "auto" : max} companies`);
  const required = tickerList(c.required_tickers);
  if (required.length) parts.push(`mandatory ${required.join(", ")}`);
  const excluded = tickerList(c.excluded_tickers);
  if (excluded.length) parts.push(`excluded ${excluded.join(", ")}`);
  parts.push(`${Number(c.timesteps).toLocaleString()} steps`);
  return parts.join(", ");
}

// Stored criteria keep a list; the editor keeps the typed text.
const tickerList = (v) => (Array.isArray(v) ? v : String(v || "").split(/[\s,]+/)).filter(Boolean);

// Blank inputs travel as null (= no limit / auto), numbers as numbers.
export const blankToNull = (v) => (v === "" || v === undefined ? null : v);
export const nullToBlank = (v) => (v === null || v === undefined ? "" : v);
