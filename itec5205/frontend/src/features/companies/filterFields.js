import { BarChartIcon, DatabaseIcon, GrowthIcon, TrendChartIcon } from "../../layout/icons";

// How many stored units (market_cap is stored in $M, free_cash_flow in raw
// $) one typed unit is worth -- lets the user type "500" and pick Billion
// instead of typing out 500000/500000000000.
export const UNIT_MULTIPLIERS = {
  market_cap: { M: 1, B: 1_000, T: 1_000_000 },
  free_cash_flow: { M: 1e6, B: 1e9, T: 1e12 },
};
export const UNIT_LABELS = { M: "Million", B: "Billion", T: "Trillion" };

// Same fields as before, just grouped for display -- no field was added,
// removed, or renamed. `short` is the label used in auto-generated pool names.
export const FILTER_GROUPS = [
  {
    title: "Market Metrics",
    icon: BarChartIcon,
    color: "#3b82f6",
    fields: [
      { key: "market_cap", label: "Market Cap", unit: true },
      { key: "trailing_pe", label: "Trailing P/E", short: "P/E" },
      { key: "forward_pe", label: "Forward P/E" },
      { key: "peg_ratio", label: "PEG Ratio (5yr expected)", short: "PEG" },
    ],
  },
  {
    title: "Profitability",
    icon: TrendChartIcon,
    color: "#16a34a",
    fields: [
      { key: "roe", label: "ROE" },
      { key: "roa", label: "ROA" },
      { key: "gross_margin", label: "Gross Margin" },
      { key: "operating_margin", label: "Operating Margin (ttm)", short: "Operating Margin" },
      { key: "net_margin", label: "Net Margin" },
    ],
  },
  {
    title: "Financial Health",
    icon: DatabaseIcon,
    color: "#7c3aed",
    fields: [
      { key: "debt_to_equity", label: "Debt/Equity" },
      { key: "current_ratio", label: "Current Ratio" },
      { key: "ev_to_ebitda", label: "EV/EBITDA" },
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
      { key: "revenue_growth_yoy", label: "Quarterly Revenue Growth (yoy) %", short: "Revenue Growth", percent: true },
      { key: "earnings_growth_yoy_q", label: "Quarterly Earnings Growth (yoy) %", short: "Earnings Growth", percent: true },
      { key: "dividend_yield", label: "Dividend Yield" },
      { key: "free_cash_flow", label: "Free Cash Flow", unit: true },
    ],
  },
  {
    // Calculated from stored price history at import time (calculated_stats),
    // not reported by Yahoo -- same percent entry convention as Growth.
    title: "Price Performance",
    icon: TrendChartIcon,
    color: "#0ea5e9",
    fields: [
      { key: "day_change", label: "Change (1D) %", short: "Change (1D)", percent: true },
      { key: "stock_growth_1y", label: "Change (1Y) %", short: "Change (1Y)", percent: true },
      { key: "volatility", label: "Volatility (1Y) %", short: "Volatility", percent: true },
    ],
  },
];

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
