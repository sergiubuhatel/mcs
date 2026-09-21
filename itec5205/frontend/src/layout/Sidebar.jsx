import { NavLink } from "react-router-dom";
import CarletonLogo from "./CarletonLogo";

const NAV_ITEMS = [
  { to: "/", label: "Analytics", end: true },
  { to: "/portfolio", label: "Portfolio" },
  { to: "/prediction", label: "Prediction" },
];

function BarsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M1 3H15M1 8H15M1 13H15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export default function Sidebar({ collapsed, onToggleCollapsed }) {
  return (
    <aside
      className="flex h-full flex-col border-r shrink-0 transition-[width]"
      style={{
        width: collapsed ? 64 : 220,
        background: "var(--color-bg-secondary)",
        borderColor: "var(--color-divider)",
      }}
    >
      <div
        className={`flex items-center px-3 py-4 ${collapsed ? "justify-center" : "justify-between"}`}
        style={{ borderBottom: "1px solid var(--color-divider)" }}
      >
        {!collapsed && (
          <div className="flex items-center" style={{ gap: 8, minWidth: 0 }}>
            <CarletonLogo height={26} style={{ color: "var(--color-text-primary)" }} />
            <span
              style={{
                color: "var(--color-text-primary)",
                fontWeight: 600,
                fontSize: "0.85rem",
                lineHeight: 1.15,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title="Carleton University"
            >
              Carleton University
            </span>
          </div>
        )}
        <button
          onClick={onToggleCollapsed}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md hover:bg-tertiary"
          style={{ color: "var(--color-text-secondary)" }}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <BarsIcon />
        </button>
      </div>

      {!collapsed && (
        <div className="px-4 pt-3 pb-1 text-[0.7rem] uppercase tracking-wide" style={{ color: "var(--color-text-secondary)" }}>
          S&amp;P 500 Screener
        </div>
      )}

      <nav className="flex flex-col gap-1 px-2 py-2">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `rounded-md border-l-2 px-3 py-2 text-sm font-medium hover:bg-tertiary ${collapsed ? "text-center" : ""} ${isActive ? "" : "border-transparent"}`
            }
            style={({ isActive }) => ({
              color: "var(--color-text-primary)",
              background: isActive ? "var(--color-bg-tertiary)" : "transparent",
              borderLeftColor: isActive ? "var(--color-text-accent)" : "transparent",
            })}
            title={item.label}
          >
            {collapsed ? item.label.slice(0, 1) : item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
