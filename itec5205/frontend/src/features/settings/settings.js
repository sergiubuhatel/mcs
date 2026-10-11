// App-wide initial values (Settings page). Built-in defaults live here; the
// backend stores only what the user saved (/api/settings). The app loads them
// once before rendering any page (see App.jsx), so pages read them with
// getSettings() in their useState initializers.
import { apiClient } from "../../api/client";
import { setFilters } from "../companies/companiesSlice";

export const DEFAULT_SETTINGS = {
  general: {
    chart_range: "1Y", // company + portfolio detail price charts
    list_page_size: 10, // Policies, Pools, Portfolios, criteria grids
    next_days: 5, // "next N days" forecast tables
  },
  data: {
    scope: "all",
    years: 10,
    only_missing: true,
    import_history: true,
    import_statistics: true,
    import_calculated_stats: true,
  },
  screening: {
    start_criteria_id: "", // open the Stock Screener with this saved search
    page_size: 50,
    sort_by: "market_cap",
    sort_dir: "desc",
    market_cap_unit: "B",
    fcf_unit: "B",
  },
  forecast: {
    training_days: 2515,
    lstm_epochs: 100,
    horizon: "3M", // Price Forecasts signal horizon
    chart_range: "6M", // Price Forecasts chart
    quick_tickers: "AAPL, MSFT, NVDA, GOOGL, AMZN",
    models: "both", // new Forecast Settings: pass rule
    training_value: 10,
    training_unit: "years",
    min_change_pct: "",
    reuse_forecasts: true,
  },
  portfolio: {
    mode: "full",
    risk_aversion: 1,
    timesteps: 20000,
    trend_window_days: 252,
    max_volatility_pct: "",
    min_return_pct: "",
    max_weight_range_pct: "",
    min_companies: "",
    max_companies: "",
  },
};

let current = DEFAULT_SETTINGS;
let saved = {};

/** Current settings: built-in defaults overlaid with the saved values. */
export const getSettings = () => current;
/** Only what the user saved (no defaults). */
export const getSavedSettings = () => saved;

// Known keys only, so a removed setting in an old save can't leak in.
export function mergeSettings(raw) {
  return Object.fromEntries(
    Object.entries(DEFAULT_SETTINGS).map(([section, defaults]) => {
      const values = raw?.[section] || {};
      return [section, Object.fromEntries(Object.keys(defaults).map((k) => [k, k in values ? values[k] : defaults[k]]))];
    })
  );
}

function setCurrent(raw) {
  saved = raw || {};
  current = mergeSettings(saved);
}

// Screener grid + search start state from the screening settings.
async function applyScreening(dispatch, s) {
  const filters = { limit: Number(s.page_size), sortBy: s.sort_by, sortDir: s.sort_dir, offset: 0 };
  if (s.start_criteria_id) {
    try {
      const { data } = await apiClient.get(`/api/criteria/screen/${s.start_criteria_id}`);
      const f = (data.criteria || data).filters || {};
      Object.assign(filters, { sector: f.sector || "", industry: f.industry || "", q: f.q || "", ranges: f.ranges || {}, units: f.units || {} });
    } catch {
      // deleted criteria: start with an empty search
    }
  }
  dispatch(setFilters(filters));
}

export async function loadSettings(dispatch) {
  try {
    const { data } = await apiClient.get("/api/settings");
    setCurrent(data.settings);
  } catch {
    setCurrent({}); // backend down: built-in defaults
  }
  await applyScreening(dispatch, current.screening);
}

export async function saveSettings(dispatch, values) {
  const { data } = await apiClient.put("/api/settings", { settings: values });
  setCurrent(data.settings);
  await applyScreening(dispatch, current.screening);
  return current;
}

// Comma-separated ticker text -> ["AAPL", ...].
export const tickerList = (text) =>
  (text || "").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
