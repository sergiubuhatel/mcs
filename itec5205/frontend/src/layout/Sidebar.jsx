import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import CarletonLogo from "./CarletonLogo";
import { BookmarkPlusIcon, CandlestickIcon, PieChartIcon, SearchIcon, TrendChartIcon } from "./icons";

const NAV_ITEMS = [
  { to: "/", label: "Fundamental Analysis", end: true, icon: SearchIcon },
  {
    label: "Technical Analysis",
    icon: CandlestickIcon,
    children: [
      { to: "/pools", label: "Pool", icon: BookmarkPlusIcon },
      { to: "/prediction", label: "Prediction", icon: TrendChartIcon },
    ],
  },
  { to: "/portfolio", label: "Portfolios", icon: PieChartIcon },
];

function BarsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M1 3H15M1 8H15M1 13H15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon({ open }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }}
    >
      <path d="M6 3L11 8L6 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const linkClassName = (collapsed) => ({ isActive }) =>
  `rounded-md border-l-2 px-3 py-2 text-sm font-medium hover:bg-tertiary ${collapsed ? "text-center" : ""} ${isActive ? "" : "border-transparent"}`;

const linkStyle = ({ isActive }) => ({
  color: "var(--color-text-primary)",
  background: isActive ? "var(--color-bg-tertiary)" : "transparent",
  borderLeftColor: isActive ? "var(--color-text-accent)" : "transparent",
});

export default function Sidebar({ collapsed, onToggleCollapsed }) {
  const location = useLocation();
  const [openGroups, setOpenGroups] = useState(() =>
    Object.fromEntries(NAV_ITEMS.filter((item) => item.children).map((item) => [item.label, true]))
  );

  const toggleGroup = (label) => setOpenGroups((prev) => ({ ...prev, [label]: !prev[label] }));

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
            <CarletonLogo height={26} />
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

      <nav className="flex flex-col gap-1 px-2 py-2">
        {NAV_ITEMS.map((item) => {
          if (item.children) {
            const isGroupActive = item.children.some((c) => c.to === location.pathname);
            const isOpen = collapsed ? true : !!openGroups[item.label];
            return (
              <div key={item.label}>
                <button
                  type="button"
                  onClick={() => !collapsed && toggleGroup(item.label)}
                  className={`flex w-full items-center rounded-md border-l-2 px-3 py-2 text-sm font-medium hover:bg-tertiary ${
                    collapsed ? "justify-center text-center" : "justify-between"
                  }`}
                  style={{
                    color: "var(--color-text-primary)",
                    background: isGroupActive ? "var(--color-bg-tertiary)" : "transparent",
                    borderLeftColor: isGroupActive ? "var(--color-text-accent)" : "transparent",
                  }}
                  title={item.label}
                >
                  <span className="flex items-center" style={{ gap: 8 }}>
                    <item.icon style={{ flexShrink: 0 }} />
                    {!collapsed && item.label}
                  </span>
                  {!collapsed && <ChevronIcon open={isOpen} />}
                </button>
                {isOpen && (
                  <div className={collapsed ? "ml-2 mt-1 flex flex-col gap-1" : "ml-3 mt-1 flex flex-col gap-1 border-l pl-2"} style={{ borderColor: "var(--color-divider)" }}>
                    {item.children.map((child) => (
                      <NavLink
                        key={child.to}
                        to={child.to}
                        end={child.end}
                        className={linkClassName(collapsed)}
                        style={linkStyle}
                        title={child.label}
                      >
                        <span className="flex items-center" style={{ gap: 8, width: "100%", justifyContent: collapsed ? "center" : "flex-start" }}>
                          <child.icon style={{ flexShrink: 0 }} />
                          {!collapsed && child.label}
                        </span>
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          }

          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={linkClassName(collapsed)}
              style={linkStyle}
              title={item.label}
            >
              <span className="flex items-center" style={{ gap: 8, width: "100%", justifyContent: collapsed ? "center" : "flex-start" }}>
                <item.icon style={{ flexShrink: 0 }} />
                {!collapsed && item.label}
              </span>
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}
