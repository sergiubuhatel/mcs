// App-wide initial values (Settings page). Built-in defaults live here; the
// backend stores only what the user saved (/api/settings). The app loads them
// once before rendering any page (see App.jsx), so pages read them with
// getSettings() in their useState initializers.
import { apiClient } from "../../api/client";
import { setFilters } from "../companies/companiesSlice";
import { intervalsFrom } from "../../utils/dateRanges";

export const DEFAULT_SETTINGS = {
  general: {
    chart_ranges: "1M, 2M, 3M, 4M, 6M, 7M, 8M, 9M, 10M, 11M, 1Y, 2Y, 3Y, 4Y, 5Y, 10Y, ALL", // range buttons of those charts
    chart_range: "1Y", // company + portfolio detail price charts
    list_page_size: 10, // Workflows, Pools, Portfolios, criteria grids
    next_days: 5, // "next N days" forecast tables
  },
  data: {
    scope: "all",
    universe: "all", // whole list: "all" (both indexes + other imported) | "sp500" | "russell3000"
    years: 10,
    existing: "skip", // companies already imported: "skip" | "update" | "reimport"
    import_history: true,
    import_statistics: true,
    import_calculated_stats: true,
    import_earnings: true,
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
    chart_ranges: "1M, 3M, 6M, 1Y, ALL", // range buttons of the Price Forecasts chart
    chart_range: "6M", // Price Forecasts chart
    band_level: 95, // confidence level (%) of the forecast bands on every chart
    quick_tickers: "AAPL, MSFT, NVDA, GOOGL, AMZN",
    models: "both", // new Forecast Settings: pass rule
    training_value: 10,
    training_unit: "years",
    min_change_pct: "",
    reuse_forecasts: true,
  },
  automation: {
    refresh_seconds: 2, // Workflows grid + run panel polling while a run is active
    open_run_panel: true, // show the run details after clicking Run
    remember_screener: false, // reopen the screener with the last applied search
    remember_columns: true, // keep grid column order / visibility in this browser
    show_tips: true, // About / Quick tips panels on the list pages
  },
  portfolio: {
    mode: "full",
    risk_aversion: 1,
    timesteps: 20000,
    trend_window_days: 252,
    max_volatility_pct: "",
    min_return_pct: "",
    max_weight_range_pct: "",
    weight_range_basis: "smallest", // what the range is measured against: smallest / largest holding, or points
    // Order Calculator (first open only; afterwards it keeps its saved plan).
    order_usd_cad: 1.4, // CAD for 1 USD until the live rate arrives
    order_allow_sell: true,
    order_spend_leftover: true,
    order_fractional: false,
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

const SCREENER_KEY = "screenerSearch";

/** Called after every applied screener search (companiesSaga). */
export function rememberScreener(filters) {
  if (!current.automation.remember_screener) return;
  try {
    localStorage.setItem(SCREENER_KEY, JSON.stringify({ ...filters, offset: 0 }));
  } catch {
    // storage full / blocked: just don't remember
  }
}

function rememberedScreener() {
  if (!current.automation.remember_screener) return null;
  try {
    return JSON.parse(localStorage.getItem(SCREENER_KEY) || "null");
  } catch {
    return null;
  }
}

// Screener grid + search start state: the remembered search if that's on,
// else the screening settings (page size, sort, optional start criteria).
async function applyScreening(dispatch, s) {
  const remembered = rememberedScreener();
  if (remembered) {
    dispatch(setFilters(remembered));
    return;
  }
  const filters = { limit: Number(s.page_size), sortBy: s.sort_by, sortDir: s.sort_dir, offset: 0 };
  if (s.start_criteria_id) {
    try {
      const { data } = await apiClient.get(`/api/criteria/screen/${s.start_criteria_id}`);
      const f = (data.criteria || data).filters || {};
      Object.assign(filters, { index: f.index || "", sector: f.sector || "", industry: f.industry || "", q: f.q || "", ranges: f.ranges || {}, units: f.units || {} });
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

/** Range buttons of a chart: "general" (company + portfolio detail) or "forecast". */
export const chartIntervals = (section) => intervalsFrom(current[section].chart_ranges, DEFAULT_SETTINGS[section].chart_ranges);

// Comma-separated ticker text -> ["AAPL", ...].
export const tickerList = (text) =>
  (text || "").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
