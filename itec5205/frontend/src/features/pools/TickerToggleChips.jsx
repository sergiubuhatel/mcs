import { CheckIcon, CloseIcon } from "../../layout/icons";

/** One chip per pool company; click to add it to / remove it from `value`.
 * `variant` "mandatory" (amber, check) or "excluded" (red, cross). Companies
 * in `blocked` (the other list) are greyed out. */
export default function TickerToggleChips({ label, help, tickers, value, onChange, variant, blocked = [], blockedLabel, disabled }) {
  const toggle = (t) => onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t]);
  const Icon = variant === "excluded" ? CloseIcon : CheckIcon;

  return (
    <div>
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {label}
        {value.length > 0 && <span className="count-badge">{value.length}</span>}
        {value.length > 0 && !disabled && (
          <a onClick={() => onChange([])} style={{ cursor: "pointer", fontSize: "0.8rem", fontWeight: 400 }}>
            Clear
          </a>
        )}
      </label>
      <p className="muted" style={{ margin: "2px 0 6px" }}>{help}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {tickers.map((t) => {
          const on = value.includes(t);
          const isBlocked = blocked.includes(t);
          return (
            <button
              key={t}
              type="button"
              className={`ticker-chip${on ? ` ${variant}` : ""}`}
              onClick={() => toggle(t)}
              disabled={disabled || isBlocked}
              aria-pressed={on}
              title={isBlocked ? `${t} ${blockedLabel}` : on ? `${t} is ${variant} — click to undo` : `Make ${t} ${variant}`}
            >
              {on && <Icon />}
              {t}
            </button>
          );
        })}
      </div>
    </div>
  );
}
