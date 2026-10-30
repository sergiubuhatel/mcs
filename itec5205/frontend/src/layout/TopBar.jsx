import { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { NavLink } from "react-router-dom";
import { ChevronDownIcon, GearIcon, GridIcon, PowerIcon, UserIcon } from "./icons";
import { apiClient } from "../api/client";
import { toggleDarkMode } from "../features/theme/themeSlice";
import { USE_KEYCLOAK } from "../auth/keycloak";
import { isAdminUser, roleLabel, useAuth } from "../auth/Authorization";

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 2.5V5M12 19v2.5M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2.5 12H5M19 12h2.5M4.2 19.8L6 18M18 6l1.8-1.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BarsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M1 3H15M1 8H15M1 13H15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// Logged-in user; the dropdown shows username + role and Logout.
function UserMenu() {
  const { keycloak } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const profile = keycloak.tokenParsed || {};
  const username = profile.preferred_username || "—";
  const displayName = profile.name || username;

  // Mark the user offline on the Dashboard right away, then end the session.
  const logout = async () => {
    await apiClient.post("/api/activity/logout").catch(() => {});
    keycloak.logout({ redirectUri: window.location.origin });
  };

  useEffect(() => {
    if (!open) return undefined;
    const onClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <div ref={ref} className="user-menu">
      <button className="theme-toggle" onClick={() => setOpen((o) => !o)} title="Signed-in user" aria-expanded={open}>
        <span className="theme-toggle-icon"><UserIcon width={18} height={18} /></span>
        {displayName}
        <ChevronDownIcon style={{ transform: open ? "rotate(180deg)" : "none" }} />
      </button>
      {open && (
        <div className="user-menu-panel">
          <div className="user-menu-info">
            <div>Username: <span>{username}</span></div>
            <div>Role: <span>{roleLabel(keycloak)}</span></div>
          </div>
          <button className="user-menu-logout" onClick={logout}>
            <PowerIcon /> Logout
          </button>
        </div>
      )}
    </div>
  );
}

export default function TopBar({ sidebarCollapsed, onToggleSidebar }) {
  const dispatch = useDispatch();
  const darkMode = useSelector((s) => s.theme.darkMode);
  const { keycloak } = useAuth();

  return (
    <header
      className="flex shrink-0 items-center justify-between gap-4 px-6"
      style={{ height: "var(--header-height)", borderBottom: "1px solid var(--color-divider)", background: "var(--color-bg-secondary)" }}
    >
      <div className="flex min-w-0 items-center gap-4">
      <button
        onClick={onToggleSidebar}
        className="sidebar-toggle"
        title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <BarsIcon />
      </button>
      <div style={{ minWidth: 0 }}>
        <div className="app-title">Investment Decision Support</div>
        <div className="app-subtitle" title="A Data-Driven Framework for S&P 500 Stock Screening, Portfolio Allocation, and Price Prediction">
          A Data-Driven Framework for S&amp;P 500 Stock Screening, Portfolio Allocation, and Price Prediction
        </div>
      </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
      <NavLink to="/" end className={({ isActive }) => `theme-toggle ${isActive ? "active" : ""}`} title="Who is signed in and what everyone is doing">
        <span className="theme-toggle-icon"><GridIcon width={18} height={18} /></span>
        Dashboard
      </NavLink>
      {isAdminUser(keycloak) && (
      <NavLink to="/settings" className={({ isActive }) => `theme-toggle ${isActive ? "active" : ""}`} title="Initial values for every page">
        <span className="theme-toggle-icon"><GearIcon width={18} height={18} /></span>
        Settings
      </NavLink>
      )}
      <button
        className="theme-toggle"
        onClick={() => dispatch(toggleDarkMode())}
        title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
      >
        <span className={darkMode ? "theme-toggle-icon sun" : "theme-toggle-icon moon"}>{darkMode ? <SunIcon /> : <MoonIcon />}</span>
        {darkMode ? "Light Mode" : "Dark Mode"}
      </button>
      {USE_KEYCLOAK && <UserMenu />}
      </div>
    </header>
  );
}
