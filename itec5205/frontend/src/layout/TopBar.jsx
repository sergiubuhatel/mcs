import { useDispatch, useSelector } from "react-redux";
import { toggleDarkMode } from "../features/theme/themeSlice";

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

export default function TopBar() {
  const dispatch = useDispatch();
  const darkMode = useSelector((s) => s.theme.darkMode);

  return (
    <header
      className="flex shrink-0 items-center justify-between gap-4 px-6"
      style={{ height: "var(--header-height)", borderBottom: "1px solid var(--color-divider)", background: "var(--color-bg-secondary)" }}
    >
      <div style={{ minWidth: 0 }}>
        <div className="app-title">Investment Decision Support</div>
        <div className="app-subtitle" title="A Data-Driven Framework for S&P 500 Stock Screening, Portfolio Allocation, and Price Prediction">
          A Data-Driven Framework for S&amp;P 500 Stock Screening, Portfolio Allocation, and Price Prediction
        </div>
      </div>
      <button
        className="theme-toggle"
        onClick={() => dispatch(toggleDarkMode())}
        title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
      >
        <span className={darkMode ? "theme-toggle-icon sun" : "theme-toggle-icon moon"}>{darkMode ? <SunIcon /> : <MoonIcon />}</span>
        {darkMode ? "Light Mode" : "Dark Mode"}
      </button>
    </header>
  );
}
