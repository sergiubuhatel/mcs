import { BarChartIcon, DatabaseIcon, GridIcon, GrowthIcon, TrendChartIcon } from "../../layout/icons";

// How many stored units (market_cap is stored in $M, free_cash_flow in raw
// $) one typed unit is worth -- lets the user type "500" and pick Billion
// instead of typing out 500000/500000000000.
export const UNIT_MULTIPLIERS = {
  market_cap: { M: 1, B: 1_000, T: 1_000_000 },
  free_cash_flow: { M: 1e6, B: 1e9, T: 1e12 },
};
export const UNIT_LABELS = { M: "Million", B: "Billion", T: "Trillion" };

// Grouped for display; `short` is the label used in auto-generated pool
// names; `hint` (what it is) and `tip` (a recommended value, in the units
// typed) fill the (i) popover next to the label.
export const FILTER_GROUPS = [
  {
    title: "Market Metrics",
    icon: BarChartIcon,
    color: "#3b82f6",
    fields: [
      { key: "market_cap", label: "Market Cap", unit: true, hint: "Company size: share price × shares outstanding", tip: "Min $2B avoids small, thinly traded companies; min $10B keeps large caps only." },
      { key: "trailing_pe", label: "Trailing P/E", short: "P/E", hint: "Price ÷ the last 12 months' earnings per share", tip: "10–25 is typical. Max 25 avoids expensive stocks; min 0 drops loss-makers (negative P/E)." },
      { key: "forward_pe", label: "Forward P/E", hint: "Price ÷ the next 12 months' expected earnings per share", tip: "Max 20–25. A forward P/E below the trailing P/E means earnings are expected to grow." },
      { key: "peg_ratio", label: "PEG Ratio (5yr expected)", short: "PEG", hint: "P/E ÷ expected 5-year earnings growth; around 1 = fairly priced for its growth", tip: "Max 1.5; 1 or less is classic \"growth at a reasonable price\". Min 0 drops shrinking earnings." },
    ],
  },
  {
    title: "Profitability",
    icon: TrendChartIcon,
    color: "#16a34a",
    fields: [
      { key: "roe", label: "ROE", hint: "Return on equity: net income ÷ shareholders' equity (ttm)", tip: "Typed as a fraction: min 0.15 (= 15%) for strong returns on equity." },
      { key: "roa", label: "ROA", hint: "Return on assets: net income ÷ total assets (ttm)", tip: "Typed as a fraction: min 0.05 (= 5%). Banks run much lower (around 0.01)." },
      { key: "gross_margin", label: "Gross Margin", hint: "Share of revenue left after the cost of goods sold", tip: "Typed as a fraction: min 0.40 (= 40%) hints at pricing power; varies a lot by industry." },
      { key: "operating_margin", label: "Operating Margin (ttm)", short: "Operating Margin", hint: "Share of revenue left after operating costs", tip: "Typed as a fraction: min 0.15 (= 15%) for efficient operations." },
      { key: "net_margin", label: "Net Margin", hint: "Share of revenue left as net profit", tip: "Typed as a fraction: min 0.10 (= 10%); min 0 drops loss-makers." },
    ],
  },
  {
    title: "Growth",
    icon: GrowthIcon,
    color: "#f59e0b",
    fields: [
      // percent: true -> the user types a plain percentage (e.g. 20 for
      // 20%); the underlying stored/filtered value is the decimal fraction
      // (0.20) yfinance itself returns, so the saga divides by 100 right
      // before this hits the API (see PERCENT_RANGE_FIELDS in companiesSaga.js).
      { key: "revenue_growth_yoy", label: "Quarterly Revenue Growth (yoy) %", short: "Revenue Growth", percent: true, hint: "Last quarter's revenue vs the same quarter a year ago", tip: "Percent: min 5–10 for growing companies." },
      { key: "earnings_growth_yoy_q", label: "Quarterly Earnings Growth (yoy) %", short: "Earnings Growth", percent: true, hint: "Last quarter's earnings vs the same quarter a year ago", tip: "Percent: min 10 for growing earnings. One quarter can be noisy, so don't set it too high." },
      { key: "dividend_yield", label: "Dividend Yield", hint: "Yearly dividends ÷ share price", tip: "Percent, as typed: min 2 for income. Above about 8 can signal a dividend at risk." },
    ],
  },
  {
    title: "Financial Health",
    icon: DatabaseIcon,
    color: "#7c3aed",
    fields: [
      { key: "debt_to_equity", label: "Debt/Equity", hint: "Total debt ÷ shareholders' equity (most recent quarter)", tip: "Stored as a percent: max 100 (debt equal to equity); max 50 for a conservative screen. Banks run high." },
      { key: "current_ratio", label: "Current Ratio", hint: "Current assets ÷ current liabilities; above 1 = can cover short-term bills", tip: "Min 1.0–1.5, so short-term assets cover short-term bills." },
      { key: "ev_to_ebitda", label: "EV/EBITDA", hint: "Enterprise value ÷ EBITDA; lower = cheaper for its operating earnings", tip: "Max 12–15 for value; growth and tech companies often run above 20." },
      { key: "free_cash_flow", label: "Free Cash Flow", unit: true, hint: "Cash from operations minus capital spending", tip: "Min 0 keeps only companies that generate cash." },
    ],
  },
  {
    // Calculated from stored price history at import time (calculated_stats),
    // not reported by Yahoo -- same percent entry convention as Growth.
    title: "Price Performance",
    icon: TrendChartIcon,
    color: "#0ea5e9",
    fields: [
      { key: "day_change", label: "Change (1D) %", short: "Change (1D)", percent: true, hint: "Latest close vs the previous close", tip: "Mostly for spotting today's movers; leave empty for long-term screens." },
      { key: "stock_growth_1y", label: "Change (1Y) %", short: "Change (1Y)", percent: true, hint: "Price change over the last 252 trading days", tip: "Min 15–20 for strong past-year performers." },
      { key: "volatility", label: "Volatility (1Y) %", short: "Volatility", percent: true, hint: "Annualized standard deviation of the past year's daily returns", tip: "Max 25–30 for steadier stocks; the S&P 500 itself runs about 15–20." },
    ],
  },
  {
    // How straight the past year's climb was (price_metrics.py). A near
    // straight uptrend: Trend R² min 0.85, Line Deviation max 10, Max Drawdown max 12.
    title: "Trend Quality",
    icon: GrowthIcon,
    color: "#14b8a6",
    fields: [
      { key: "trend_r2", label: "Trend R² (1Y, -1 to 1)", short: "Trend R²", hint: "How close the price is to a straight line: 1 = perfectly straight climb, negative = downtrend", tip: "Min 0.85 for a clear line, 0.9 for a very straight one. Above 0.95 matches very few." },
      { key: "line_deviation", label: "Line Deviation (1Y) %", short: "Line Deviation", percent: true, hint: "The furthest the price strayed from its straight trend line; small = close to a straight line", tip: "Max 10 for near-straight, 8 for the straightest. Below 7 matched nothing in the past year." },
      { key: "max_drawdown", label: "Max Drawdown (1Y) %", short: "Max Drawdown", percent: true, hint: "Largest drop from a past-year peak", tip: "Max 12–15; max 10 for very smooth climbs." },
      { key: "up_months", label: "Up Months (1Y, of ~12)", short: "Up Months", hint: "Months that closed higher than the month before", tip: "Min 9; min 10 for very steady climbs." },
      { key: "worst_month", label: "Worst Month (1Y) %", short: "Worst Month", percent: true, hint: "The smallest monthly change over the past year: min 0 = rose every month, min 1 = rose at least 1% every month", tip: "Min -3 to -5 together with the trend filters. No stock rose every month in the past year, so min 0 matches nothing." },
      { key: "trend_return", label: "Trend-Adjusted Return (1Y) %", short: "Trend Return", percent: true, hint: "Change (1Y) × Trend R²", tip: "Best as a sort column. As a filter, min 15 keeps meaningful climbs." },
    ],
  },
];

// The screener / screening-criteria filter tabs (FilterTabs.jsx), each
// showing some of the groups above. Overview sums up what's set in each.
export const FILTER_TABS = [
  { id: "overview", title: "Overview", icon: GridIcon, color: "#64748b", heading: "Overview", subtitle: "Which filters are set in each tab", groups: [] },
  { id: "fundamentals", title: "Fundamentals", icon: BarChartIcon, color: "#3b82f6", heading: "Fundamental Metrics", subtitle: "Filter by key valuation, profitability, and growth metrics", groups: ["Market Metrics", "Profitability", "Growth"] },
  { id: "health", title: "Financial Health", icon: DatabaseIcon, color: "#7c3aed", heading: "Financial Health", subtitle: "Filter by debt, liquidity, and cash generation", groups: ["Financial Health"] },
  { id: "performance", title: "Performance", icon: TrendChartIcon, color: "#0ea5e9", heading: "Price Performance", subtitle: "Filter by recent price moves and volatility, calculated from stored prices", groups: ["Price Performance"] },
  { id: "trend", title: "Trend Quality", icon: GrowthIcon, color: "#14b8a6", heading: "Trend Quality", subtitle: "Filter by how straight and steady the past year's climb was", groups: ["Trend Quality"] },
];
export const tabGroups = (tab) => FILTER_GROUPS.filter((g) => tab.groups.includes(g.title));
export const tabFields = (tab) => tabGroups(tab).flatMap((g) => g.fields);

// Unit fields are held in state already multiplied into stored units; turn
// them back into a compact "$500B" for display.
const TO_DOLLARS = { market_cap: 1e6, free_cash_flow: 1 };
const round = (n) => String(Number(n.toFixed(2)));

function formatBound(field, value) {
  if (field.unit) {
    const dollars = Number(value) * TO_DOLLARS[field.key];
    if (Math.abs(dollars) >= 1e12) return `$${round(dollars / 1e12)}T`;
    if (Math.abs(dollars) >= 1e9) return `$${round(dollars / 1e9)}B`;
    return `$${round(dollars / 1e6)}M`;
  }
  return field.percent ? `${value}%` : String(value);
}

const isSet = (v) => v !== "" && v !== null && v !== undefined && !Number.isNaN(Number(v));

// Index lists the screener can limit companies to (backend services/universes.py).
export const INDEXES = [
  { value: "sp500", label: "S&P 500" },
  { value: "russell3000", label: "Russell 3000" },
];
export const indexLabel = (value) => INDEXES.find((i) => i.value === value)?.label || "";

// One entry per filled-in search field, in form order: { id, label, field }
// where `field` is "q" / "sector" / "industry" or a range key. Drives the
// screener's removable "Active filters" chips and the auto pool names.
export function activeFilters(filters) {
  const out = [];
  if (filters.index) out.push({ id: "index", field: "index", label: indexLabel(filters.index) });
  if (filters.q?.trim()) out.push({ id: "q", field: "q", label: `"${filters.q.trim()}"` });
  if (filters.sector) out.push({ id: "sector", field: "sector", label: filters.sector });
  if (filters.industry) out.push({ id: "industry", field: "industry", label: filters.industry });

  for (const group of FILTER_GROUPS) {
    for (const field of group.fields) {
      const [min, max] = filters.ranges?.[field.key] || ["", ""];
      const name = field.short || field.label;
      const hasMin = isSet(min);
      const hasMax = isSet(max);
      let label = null;
      if (hasMin && hasMax) label = `${name} ${formatBound(field, min)}–${formatBound(field, max)}`;
      else if (hasMin) label = `${name} ≥ ${formatBound(field, min)}`;
      else if (hasMax) label = `${name} ≤ ${formatBound(field, max)}`;
      if (label) out.push({ id: field.key, field: field.key, label, group: group.title });
    }
  }
  return out;
}

// Builds a readable pool name from the screener's filled-in fields, e.g.
// "Technology, P/E ≤ 30, Revenue Growth ≥ 40%". Returns "" when nothing
// is filled in. (An industry already implies its sector.)
export function describeFilters(filters) {
  return activeFilters(filters)
    .filter((f) => !(f.field === "sector" && filters.industry))
    .map((f) => f.label)
    .join(", ");
}
