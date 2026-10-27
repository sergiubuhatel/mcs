import { useEffect, useRef, useState } from "react";
import { CalendarIcon, ChevronDownIcon, CloseIcon } from "../layout/icons";
import { chartIntervals, chartMoreIntervals } from "../features/settings/settings";
import { customDates, customRange, intervalName } from "../utils/dateRanges";

const BTN = { padding: "4px 10px", fontSize: "0.78rem" };
const today = () => new Date().toISOString().slice(0, 10);
const yearAgo = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
};

// Closes a popover on a click outside `ref` or on Escape.
function useDismiss(open, setOpen, ref) {
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen, ref]);
}

/** Chart range picker: the Settings range buttons of `section`, a "More" menu
 * with the other Settings ranges, and a Custom start/end date range. `value`
 * is a range key ("1Y", "ALL") or a custom "YYYY-MM-DD..YYYY-MM-DD". */
export default function RangePicker({ section, value, onChange }) {
  const buttons = chartIntervals(section);
  const more = chartMoreIntervals(section);
  const custom = customDates(value);
  const moreActive = more.some((iv) => iv.key === value);

  const [moreOpen, setMoreOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [from, setFrom] = useState(custom?.from || yearAgo());
  const [to, setTo] = useState(custom?.to || today());
  const moreRef = useRef(null);
  const customRef = useRef(null);
  useDismiss(moreOpen, setMoreOpen, moreRef);
  useDismiss(customOpen, setCustomOpen, customRef);

  const openCustom = () => {
    if (custom) {
      setFrom(custom.from);
      setTo(custom.to);
    }
    setMoreOpen(false);
    setCustomOpen((o) => !o);
  };
  const apply = () => {
    onChange(customRange(from, to));
    setCustomOpen(false);
  };

  return (
    <div className="range-picker">
      {buttons.map((iv) => (
        <button key={iv.key} className={value === iv.key ? "btn" : "btn secondary"} style={BTN} onClick={() => onChange(iv.key)}>
          {iv.key}
        </button>
      ))}

      {more.length > 0 && (
        <div ref={moreRef} className="range-pop-anchor">
          <button
            className={moreActive ? "btn" : "btn secondary"}
            style={BTN}
            onClick={() => {
              setCustomOpen(false);
              setMoreOpen((o) => !o);
            }}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
          >
            {moreActive ? value : "More"} <ChevronDownIcon width={12} height={12} />
          </button>
          {moreOpen && (
            <div className="range-pop range-menu" role="menu">
              {more.map((iv, i) => (
                <button
                  key={iv.key}
                  role="menuitem"
                  className={`${value === iv.key ? "active" : ""} ${i > 0 && iv.key.slice(-1) !== more[i - 1].key.slice(-1) ? "sep" : ""}`}
                  onClick={() => {
                    onChange(iv.key);
                    setMoreOpen(false);
                  }}
                >
                  {intervalName(iv.key)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div ref={customRef} className="range-pop-anchor">
        <button
          className={custom ? "btn" : "btn secondary"}
          style={BTN}
          onClick={openCustom}
          title={custom ? `${custom.from} to ${custom.to}` : "Pick a start and end date"}
          aria-expanded={customOpen}
        >
          <CalendarIcon width={13} height={13} /> Custom <ChevronDownIcon width={12} height={12} />
        </button>
        {customOpen && (
          <div className="range-pop range-custom" role="dialog" aria-label="Custom date range">
            <div className="range-custom-head">
              <CalendarIcon width={15} height={15} /> Custom date range
              <button type="button" className="icon-btn" onClick={() => setCustomOpen(false)} aria-label="Close">
                <CloseIcon />
              </button>
            </div>
            <div className="range-custom-fields">
              <label>
                Start date
                <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label>
                End date
                <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
              </label>
            </div>
            <button className="btn" style={{ width: "100%", justifyContent: "center" }} onClick={apply} disabled={!from || !to}>
              Apply
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
