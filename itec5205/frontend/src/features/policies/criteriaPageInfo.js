// Page copy for the four criteria pages: header color, About features, Quick tips.
import {
  BarChartIcon,
  ClockIcon,
  DatabaseIcon,
  DownloadIcon,
  LayersIcon,
  ListIcon,
  PieChartIcon,
  SearchIcon,
  SlidersIcon,
  StarIcon,
  TrendChartIcon,
  WorkflowIcon,
} from "../../layout/icons";

export const CRITERIA_PAGES = {
  data: {
    title: "Data Filters",
    color: "#10b981",
    description: "Saved Yahoo Finance import settings. A policy with a data criteria imports first, so it screens and forecasts on fresh data.",
    about: {
      icon: DatabaseIcon,
      color: "#10b981",
      title: "About data criteria",
      text: "A data criteria is the Market Data import form, saved. It is optional on a policy: without one, the run uses the data already stored.",
      features: [
        { icon: DatabaseIcon, color: "#10b981", title: "Which companies", text: "All 503 S&P 500 tickers, or a list you type." },
        { icon: ClockIcon, color: "#8b5cf6", title: "How far back", text: "1 to 20 years of daily prices. Forecasts train on 10 years by default." },
        { icon: BarChartIcon, color: "#3b82f6", title: "What to import", text: "Price history, statistics and calculated statistics, in any combination." },
        { icon: DownloadIcon, color: "#f59e0b", title: "Only what's missing", text: "Skips tickers already up to date, so a run on fresh data imports nothing." },
      ],
    },
    tips: [
      { title: "Keep one everyday set", text: "All S&P 500, 10 years, only what's missing: cheap to run before every policy." },
      { title: "Mark it as default", text: "Use ⋯ → Set as default; new policies then start with it selected." },
      { title: "Leave it off when you're iterating", text: "A policy without data criteria skips the import entirely." },
    ],
  },
  screen: {
    title: "Screening Criteria",
    color: "#3b82f6",
    description: "Saved Stock Screener searches. A policy uses one to pick the companies it forecasts and builds a portfolio from.",
    about: {
      icon: SearchIcon,
      color: "#3b82f6",
      title: "About screening criteria",
      text: "A screening criteria is a Stock Screener search, saved: sector, industry, name and min/max ranges on any fundamental. It runs first in a policy, after the optional import.",
      features: [
        { icon: SearchIcon, color: "#3b82f6", title: "Filter companies", text: "Valuation, profitability, debt, growth and price performance ranges." },
        { icon: LayersIcon, color: "#8b5cf6", title: "Several strategies", text: "Save a value screen, a growth screen and so on, and compare their policies." },
        { icon: ListIcon, color: "#10b981", title: "Live match count", text: "The editor shows how many companies the screen matches today." },
        { icon: SlidersIcon, color: "#f59e0b", title: "From the screener", text: "\"Copy current Stock Screener search\" saves what you already filled in." },
      ],
    },
    tips: [
      { title: "Start on the Stock Screener", text: "Tune the search there, then copy it into a new screening criteria." },
      { title: "Watch the match count", text: "Every match is forecast in a policy run, so a broad screen takes longer." },
      { title: "Compare strategies", text: "Duplicate a criteria, change one range, and run both policies." },
    ],
  },
  prediction: {
    title: "Forecast Settings",
    color: "#06b6d4",
    description: "Saved forecast rules: when to predict, how much history to train on, and which forecasts a company must pass.",
    about: {
      icon: TrendChartIcon,
      color: "#06b6d4",
      title: "About prediction criteria",
      text: "A prediction criteria decides which screened companies go on to the portfolio: LSTM and/or ARIMA must forecast a rise at every point you choose.",
      features: [
        { icon: ClockIcon, color: "#06b6d4", title: "Points in time", text: "Any list of days, weeks, months or years ahead, in business days." },
        { icon: DatabaseIcon, color: "#10b981", title: "Training window", text: "Business days, or months/years of them; 10 years ≈ 2,515 days." },
        { icon: TrendChartIcon, color: "#3b82f6", title: "Pass rule", text: "Both models up, either one, or a single model, with an optional minimum rise." },
        { icon: WorkflowIcon, color: "#8b5cf6", title: "Reuse forecasts", text: "Forecasts already trained on the same data are reused, so re-runs are fast." },
      ],
    },
    tips: [
      { title: "Start with 1–4 months", text: "Short horizons such as 3 days are noisier for both models." },
      { title: "Both models is the strictest", text: "\"Either\" keeps more companies; a minimum rise % narrows them again." },
      { title: "Keep reuse on", text: "Turn it off only to force fresh training, e.g. after changing epochs." },
    ],
  },
  portfolio: {
    title: "Portfolio Constraints",
    color: "#22c55e",
    description: "Saved RL portfolio settings: volatility and return limits, weight range, company counts and training options.",
    about: {
      icon: PieChartIcon,
      color: "#22c55e",
      title: "About portfolio criteria",
      text: "A portfolio criteria is the RL panel's options, saved. It builds the final portfolio from the companies that passed the prediction criteria.",
      features: [
        { icon: BarChartIcon, color: "#22c55e", title: "Risk and return limits", text: "Max annual volatility and min annual return, measured over the past year." },
        { icon: SlidersIcon, color: "#3b82f6", title: "Weight range", text: "How much bigger the largest holding may be than the smallest: in % of the smallest or largest, or in points." },
        { icon: ListIcon, color: "#8b5cf6", title: "Company count", text: "Min and max companies; blank lets the optimizer decide." },
        { icon: StarIcon, color: "#f59e0b", title: "Training", text: "Risk aversion and PPO timesteps; more timesteps train longer." },
      ],
    },
    tips: [
      { title: "Set one limit at a time", text: "A volatility cap alone maximizes return under it; a return floor alone minimizes volatility." },
      { title: "Check feasibility", text: "If a limit can't be met, the portfolio says so and shows the best achievable." },
      { title: "Use the weight range for balance", text: "e.g. 50 % of smallest keeps the largest holding at most 1.5× the smallest (10% → at most 15%)." },
    ],
  },
};
