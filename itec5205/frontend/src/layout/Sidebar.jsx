import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { apiClient } from "../api/client";
import CarletonLogo from "./CarletonLogo";
import {
  BarChartIcon,
  BookmarkPlusIcon,
  CandlestickIcon,
  DatabaseIcon,
  DownloadIcon,
  ListIcon,
  PieChartIcon,
  PlayIcon,
  SearchIcon,
  SlidersIcon,
  TrendChartIcon,
  WorkflowIcon,
} from "./icons";
import { APP_VERSION, APP_VERSION_DATE } from "../version";

// One group per step a policy runs, in order, then Policies (which runs them
// all). Each step's page sits next to its saved criteria (sliders icon).
// `hint` is the hover text, which also names the icons when collapsed.
const GROUPS = [
  {
    title: "Data",
    icon: DatabaseIcon,
    color: "#10b981",
    items: [
      { to: "/data", label: "Market Data", icon: DownloadIcon, hint: "Import prices and fundamentals from Yahoo Finance" },
      { to: "/criteria/data", label: "Data Criteria", icon: SlidersIcon, hint: "Saved import settings for policies" },
    ],
  },
  {
    title: "Screening",
    icon: SearchIcon,
    color: "#3b82f6",
    items: [
      { to: "/", end: true, label: "Stock Screener", icon: ListIcon, hint: "Filter the S&P 500 by fundamentals and save a pool" },
      { to: "/criteria/screen", label: "Screening Criteria", icon: SlidersIcon, hint: "Saved screener searches for policies" },
      { to: "/pools", label: "Stock Pools", icon: BookmarkPlusIcon, hint: "Saved pools: signal board, forecasts and the RL builder" },
    ],
  },
  {
    title: "Prediction",
    icon: TrendChartIcon,
    color: "#06b6d4",
    items: [
      { to: "/prediction", label: "Price Forecasts", icon: CandlestickIcon, hint: "LSTM and ARIMA price forecasts per company" },
      { to: "/criteria/prediction", label: "Prediction Criteria", icon: SlidersIcon, hint: "Saved forecast points, training window and pass rule" },
    ],
  },
  {
    title: "Portfolio",
    icon: PieChartIcon,
    color: "#22c55e",
    items: [
      { to: "/portfolio", label: "My Portfolios", icon: BarChartIcon, hint: "Saved portfolios with performance and allocation" },
      { to: "/criteria/portfolio", label: "Portfolio Criteria", icon: SlidersIcon, hint: "Saved RL portfolio limits and settings" },
    ],
  },
  {
    title: "Policies",
    icon: WorkflowIcon,
    color: "#6366f1",
    items: [
      {
        to: "/policies",
        label: "Policies",
        icon: PlayIcon,
        hint: "Run Data → Screening → Prediction → Portfolio automatically and get a portfolio",
        countKey: "runningPolicies",
      },
    ],
  },
];

const ACTIVE_RUN = ["queued", "running"];
const POLL_MS = 10000;

function BarsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M1 3H15M1 8H15M1 13H15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

// How many policies are running right now (badge on Policies).
function useRunningPolicies() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      apiClient
        .get("/api/policies")
        .then((r) => alive && setCount(r.data.policies.filter((p) => ACTIVE_RUN.includes(p.last_run?.status)).length))
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
      className={({ isActive }) => `nav-item ${isActive ? "active" : ""} ${collapsed ? "collapsed" : ""}`}
      title={(collapsed ? `${item.label} — ${item.hint}` : item.hint) + countTitle}
    >
      <Icon width={15} height={15} />
      {!collapsed && <span className="nav-label">{item.label}</span>}
      {count > 0 && <span className="nav-count">{count}</span>}
    </NavLink>
  );
}

export default function Sidebar({ collapsed, onToggleCollapsed }) {
  const counts = { runningPolicies: useRunningPolicies() };
  return (
    <aside
      className="flex h-full flex-col border-r shrink-0 transition-[width]"
      style={{
        width: collapsed ? 64 : 220,
        background: "var(--color-bg-secondary)",
        borderColor: "var(--color-divider)",
      }}
    >
      {/* Same height as the top bar, so logo and title read as one header row. */}
      <div
        className={`flex items-center px-3 ${collapsed ? "justify-center" : "justify-between"}`}
        style={{ height: "var(--header-height)", borderBottom: "1px solid var(--color-divider)", flexShrink: 0 }}
      >
        {!collapsed && (
          <NavLink to="/" className="brand-link" title="Home: Stock Screener">
            <CarletonLogo height={40} />
            <span className="brand-wordmark">
              Carleton
              <br />
              University
            </span>
          </NavLink>
        )}
        <button
          onClick={onToggleCollapsed}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md hover:bg-tertiary"
          style={{ color: "var(--color-text-secondary)" }}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <BarsIcon />
        </button>
      </div>

      <nav className="flex flex-col px-2 py-2" style={{ overflowY: "auto" }}>
        {GROUPS.map((group) => {
          const GroupIcon = group.icon;
          return (
            <div key={group.title} className="nav-group flex flex-col" style={{ gap: 2 }}>
              {!collapsed && (
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
        <div
          className="mt-auto text-center"
          style={{
            fontSize: "0.72rem",
            color: "var(--color-text-secondary)",
            padding: "8px 0",
            borderTop: "1px solid var(--color-divider)",
          }}
        >
          Version {APP_VERSION}, {APP_VERSION_DATE}
        </div>
      )}
    </aside>
  );
}
