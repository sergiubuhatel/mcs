import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { apiClient } from "../api/client";
import CarletonLockup from "./CarletonLockup";
import CarletonCrest from "./CarletonLogo";
import {
  BarChartIcon,
  BookmarkPlusIcon,
  CalculatorIcon,
  CandlestickIcon,
  ClipboardCheckIcon,
  DatabaseIcon,
  DownloadIcon,
  GearIcon,
  ImageIcon,
  ListIcon,
  PieChartIcon,
  SearchIcon,
  SlidersIcon,
  TrendChartIcon,
  WorkflowIcon,
} from "./icons";
import { APP_VERSION, APP_VERSION_DATE } from "../version";

// One group per step a workflow runs, in order, then Workflows (which runs them
// all). Each step's page sits next to its saved criteria (sliders icon).
// `hint` is the hover text, which also names the icons when collapsed.
const GROUPS = [
  {
    title: "Data",
    icon: DatabaseIcon,
    color: "#10b981",
    items: [
      { to: "/data", label: "Market Data", icon: DownloadIcon, hint: "Import prices and fundamentals from Yahoo Finance" },
      { to: "/criteria/data", label: "Data Filters", icon: SlidersIcon, hint: "Saved import settings (data criteria) for workflows" },
    ],
  },
  {
    title: "Screening",
    icon: SearchIcon,
    color: "#3b82f6",
    items: [
      { to: "/screener", label: "Stock Screener", icon: ListIcon, hint: "Filter the S&P 500 by fundamentals and save a pool" },
      { to: "/criteria/screen", label: "Screening Criteria", icon: SlidersIcon, hint: "Saved screener searches for workflows" },
      { to: "/pools", label: "Stock Pools", icon: BookmarkPlusIcon, hint: "Saved pools: signal board, forecasts and the RL builder" },
    ],
  },
  {
    title: "Forecasting",
    icon: TrendChartIcon,
    color: "#06b6d4",
    items: [
      { to: "/prediction", label: "Price Forecasts", icon: CandlestickIcon, hint: "LSTM and ARIMA price forecasts per company" },
      { to: "/criteria/prediction", label: "Forecast Settings", icon: GearIcon, hint: "Saved prediction criteria: forecast points, training window and pass rule" },
    ],
  },
  {
    title: "Portfolio",
    icon: PieChartIcon,
    color: "#22c55e",
    items: [
      { to: "/portfolio", label: "Portfolios", icon: BarChartIcon, hint: "Saved portfolios with performance and allocation" },
      { to: "/criteria/portfolio", label: "Portfolio Constraints", icon: SlidersIcon, hint: "Saved portfolio criteria: RL limits and settings" },
    ],
  },
  {
    title: "Automation",
    icon: WorkflowIcon,
    color: "#6366f1",
    items: [
      {
        to: "/workflows",
        label: "Workflows",
        icon: ClipboardCheckIcon,
        hint: "Run Data → Screening → Forecasting → Portfolio automatically and get a portfolio",
        countKey: "runningWorkflows",
      },
    ],
  },
  {
    title: "Trading",
    icon: CalculatorIcon,
    color: "#0ea5e9",
    items: [
      {
        to: "/combine-portfolios",
        label: "Portfolio of Portfolios",
        icon: PieChartIcon,
        hint: "Combine saved portfolios into one, each with its share of the total (e.g. 50% / 25% / 25%)",
      },
      {
        to: "/import-portfolio",
        label: "Import Portfolio",
        icon: ImageIcon,
        hint: "Create a portfolio from a screenshot of your brokerage positions (weights = shares of the market value)",
      },
      {
        to: "/orders",
        label: "Order Calculator",
        icon: CalculatorIcon,
        hint: "Shares to sell and buy in each account (RRSP, TFSA…) to reach a portfolio, in CAD; can read what you hold from a screenshot",
      },
    ],
  },
];

const ACTIVE_RUN = ["queued", "running"];
const POLL_MS = 10000;

// How many workflows are running right now (badge on Workflows).
function useRunningWorkflows() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      apiClient
        .get("/api/workflows")
        .then((r) => alive && setCount(r.data.workflows.filter((p) => ACTIVE_RUN.includes(p.last_run?.status)).length))
        .catch(() => {});
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return count;
}

function NavItem({ item, collapsed, counts }) {
  const Icon = item.icon;
  const count = item.countKey ? counts[item.countKey] : 0;
  const countTitle = count ? ` (${count} running)` : "";
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) => `nav-item ${isActive ? "active" : ""} ${collapsed ? "collapsed" : ""} ${item.standalone ? "standalone" : ""}`}
      title={(collapsed ? `${item.label} — ${item.hint}` : item.hint) + countTitle}
    >
      <Icon width={18} height={18} />
      {!collapsed && <span className="nav-label">{item.label}</span>}
      {count > 0 && <span className="nav-count">{count}</span>}
    </NavLink>
  );
}

export default function Sidebar({ collapsed }) {
  const counts = { runningWorkflows: useRunningWorkflows() };
  return (
    <aside
      className="flex h-full flex-col border-r shrink-0 transition-[width]"
      style={{
        width: collapsed ? 68 : 250,
        background: "var(--color-bg-secondary)",
        borderColor: "var(--color-divider)",
      }}
    >
      {/* Same height as the top bar, so logo and title read as one header row. */}
      <div
        className="flex items-center justify-center px-3"
        style={{ height: "var(--header-height)", borderBottom: "1px solid var(--color-divider)", flexShrink: 0 }}
      >
        <NavLink to="/" className="brand-link" title="Home: Dashboard" aria-label="Carleton University — home">
          {collapsed ? <CarletonCrest height={36} /> : <CarletonLockup height={42} />}
        </NavLink>
      </div>

      <nav className="flex min-h-0 flex-col px-3 py-3" style={{ overflowY: "auto" }}>
        {GROUPS.map((group) => {
          const GroupIcon = group.icon;
          return (
            <div key={group.title} className="nav-group flex flex-col" style={{ gap: 2 }}>
              {!collapsed && !group.standalone && (
                <div className="nav-section">
                  <GroupIcon style={{ color: group.color }} />
                  {group.title}
                </div>
              )}
              {group.items.map((item) => (
                <NavItem key={item.to} item={item} collapsed={collapsed} counts={counts} />
              ))}
            </div>
          );
        })}
      </nav>
      {!collapsed && (
        <div className="sidebar-version mt-auto">
          <div>Version {APP_VERSION} · {APP_VERSION_DATE}</div>
        </div>
      )}
    </aside>
  );
}
