import { describeFilters } from "../companies/filterFields";

export const KINDS = {
  screen: { title: "Screen Criteria", singular: "screen criteria", blurb: "The Fundamental Analysis search: which companies a policy starts from." },
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

export const DEFAULTS = {
  screen: { name: "", description: "", filters: { sector: "", industry: "", q: "", ranges: {}, units: {} } },
  prediction: {
    name: "",
    description: "",
    horizons: [1, 2, 3, 4].map((value) => ({ value, unit: "months" })),
    training: { value: 10, unit: "years" },
    models: "both",
    min_change_pct: "",
    epochs: 100,
    reuse_forecasts: true,
  },
  portfolio: {
    name: "",
    description: "",
    mode: "full",
    trend_window_days: 252,
    risk_aversion: 1,
    timesteps: 20000,
    max_volatility_pct: "",
    min_return_pct: "",
    min_companies: "",
    max_companies: "",
  },
};

const plural = (value, unit) => `${value} ${Number(value) === 1 ? unit.replace(/s$/, "") : unit}`;
const isSet = (v) => v !== null && v !== undefined && v !== "";

// Compact horizon label for names: 3D, 1W, 2M, 1Y.
const shortHorizon = (h) => `${h.value}${{ days: "D", weeks: "W", months: "M", years: "Y" }[h.unit]}`;
const RULE_SHORT = { both: "LSTM + ARIMA up", either: "LSTM or ARIMA up", lstm: "LSTM up", arima: "ARIMA up" };

/** A readable default name generated from the criteria's own settings,
 * e.g. "Technology, P/E ≤ 30" or "LSTM + ARIMA up at 1M, 3M · 10Y training". */
export function autoCriteriaName(kind, c) {
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
  const min = c.min_companies;
  const max = c.max_companies;
  if (isSet(min) && min === max) parts.push(`${min} companies`);
  else if (isSet(min) && isSet(max)) parts.push(`${min}–${max} companies`);
  else if (isSet(min)) parts.push(`≥ ${min} companies`);
  else if (isSet(max)) parts.push(`≤ ${max} companies`);
  if (c.mode === "subset") parts.push("steady trend");
  return parts.length ? parts.join(", ") : "Whole pool, no limits";
}

/** Policy name from its three criteria's names. */
export function autoPolicyName(screen, prediction, portfolio) {
  return [screen, prediction, portfolio].filter(Boolean).map((c) => c.name).join(" → ");
}

/** `name`, or "name (2)", "name (3)", ... if another item already has it. */
export function uniqueName(name, items, ownId = null) {
  const taken = new Set(items.filter((i) => i._key !== ownId).map((i) => i.name));
  if (!taken.has(name)) return name;
  let n = 2;
  while (taken.has(`${name} (${n})`)) n += 1;
  return `${name} (${n})`;
}

export function describeCriteria(kind, c) {
  if (!c) return "";
  if (kind === "screen") return describeFilters(c.filters || {}) || "All companies (no filters)";
  if (kind === "prediction") {
    const points = (c.horizons || []).map((h) => plural(h.value, h.unit)).join(", ");
    const change = c.min_change_pct != null && c.min_change_pct !== "" ? ` by ≥ ${c.min_change_pct}%` : "";
    return `${MODEL_RULES[c.models] || c.models}${change} at ${points}; trained on ${plural(c.training.value, c.training.unit)}`;
  }
  const parts = [c.mode === "subset" ? "Steady upward trend only" : "Whole pool"];
  if (c.max_volatility_pct != null && c.max_volatility_pct !== "") parts.push(`volatility ≤ ${c.max_volatility_pct}%`);
  if (c.min_return_pct != null && c.min_return_pct !== "") parts.push(`annual return ≥ ${c.min_return_pct}%`);
  const min = c.min_companies ?? "";
  const max = c.max_companies ?? "";
  if (min !== "" || max !== "") parts.push(`${min === "" ? "auto" : min}–${max === "" ? "auto" : max} companies`);
  parts.push(`${Number(c.timesteps).toLocaleString()} steps`);
  return parts.join(", ");
}

// Blank inputs travel as null (= no limit / auto), numbers as numbers.
export const blankToNull = (v) => (v === "" || v === undefined ? null : v);
export const nullToBlank = (v) => (v === null || v === undefined ? "" : v);
