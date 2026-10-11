import { describeFilters } from "../companies/filterFields";
import { defaultImportOptions } from "../dataImport/ImportControls";
import { getSettings } from "../settings/settings";

// In run order: a policy imports (data), screens, predicts, then builds the portfolio.
export const KINDS = {
  data: {
    title: "Data Criteria",
    singular: "data criteria",
    optional: true, // a policy without one skips the import and uses the stored data
    blurb: "The Yahoo Finance import a policy can run first, so it screens and forecasts on fresh data.",
  },
  screen: { title: "Screening Criteria", singular: "screening criteria", blurb: "The Stock Screener search: which companies a policy starts from." },
  prediction: {
    title: "Prediction Criteria",
    singular: "prediction criteria",
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
      filters: { sector: "", industry: "", q: "", ranges: {}, units: { market_cap: s.market_cap_unit, free_cash_flow: s.fcf_unit } },
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
      min_companies: p.min_companies,
      max_companies: p.max_companies,
    },
  };
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
    return `${d.scope} · ${d.years} history${full ? "" : ` · ${d.what}`}${d.missing ? " · only missing" : ""}`;
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
  if (isSet(c.max_weight_range_pct)) parts.push(`Range ≤ ${c.max_weight_range_pct}%`);
  const min = c.min_companies;
  const max = c.max_companies;
  if (isSet(min) && min === max) parts.push(`${min} companies`);
  else if (isSet(min) && isSet(max)) parts.push(`${min}–${max} companies`);
  else if (isSet(min)) parts.push(`≥ ${min} companies`);
  else if (isSet(max)) parts.push(`≤ ${max} companies`);
  if (c.mode === "subset") parts.push("steady trend");
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
  const scope = c.scope === "specific" ? tickers || "no tickers" : "All S&P 500";
  return { scope, years: `${c.years}Y`, what: what.join(" + ") || "nothing", missing: c.scope === "all" && c.only_missing && c.import_history };
}

export function describeCriteria(kind, c) {
  if (!c) return "";
  if (kind === "data") {
    const d = describeData(c);
    return `${d.scope}: ${d.what} since ${c.years} year${Number(c.years) === 1 ? "" : "s"} ago${d.missing ? ", only what's missing" : ", always re-fetched"}`;
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
  if (isSet(c.max_weight_range_pct)) parts.push(`weight range ≤ ${c.max_weight_range_pct} pts`);
  const min = c.min_companies ?? "";
  const max = c.max_companies ?? "";
  if (min !== "" || max !== "") parts.push(`${min === "" ? "auto" : min}–${max === "" ? "auto" : max} companies`);
  parts.push(`${Number(c.timesteps).toLocaleString()} steps`);
  return parts.join(", ");
}

// Blank inputs travel as null (= no limit / auto), numbers as numbers.
export const blankToNull = (v) => (v === "" || v === undefined ? null : v);
export const nullToBlank = (v) => (v === null || v === undefined ? "" : v);
