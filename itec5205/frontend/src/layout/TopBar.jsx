import { useDispatch, useSelector } from "react-redux";
import { toggleDarkMode } from "../features/theme/themeSlice";

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
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
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
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
      className="flex h-14 shrink-0 items-center justify-end px-4"
      style={{ borderBottom: "1px solid var(--color-divider)", background: "var(--color-bg-secondary)" }}
    >
      <button
        className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm hover:bg-tertiary"
        style={{ color: "var(--color-text-secondary)" }}
        onClick={() => dispatch(toggleDarkMode())}
      >
        {darkMode ? <SunIcon /> : <MoonIcon />}
        {darkMode ? "Light Mode" : "Dark Mode"}
      </button>
    </header>
  );
}
