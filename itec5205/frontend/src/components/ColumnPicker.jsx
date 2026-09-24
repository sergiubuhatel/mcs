import { useEffect, useRef, useState } from "react";
import { ColumnsIcon } from "../layout/icons";

export default function ColumnPicker({ columns, hidden, onToggle, onMove, onReset }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button type="button" className="btn secondary" onClick={() => setOpen((o) => !o)} title="Add, remove, or reorder columns">
        <ColumnsIcon /> Columns
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 4px)",
            zIndex: 30,
            width: 260,
            maxHeight: 360,
            overflowY: "auto",
            background: "var(--color-bg-secondary)",
            border: "1px solid var(--color-divider)",
            borderRadius: 8,
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            padding: 8,
          }}
        >
          {columns.map((c, i) => (
            <div key={c.key} style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 4px" }}>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: "0.83rem",
                  flex: 1,
                  minWidth: 0,
                  cursor: c.locked ? "default" : "pointer",
                  color: c.locked ? "var(--color-text-secondary)" : "var(--color-text-primary)",
                }}
              >
                <input
                  type="checkbox"
                  checked={!hidden.includes(c.key)}
                  disabled={c.locked}
                  onChange={() => onToggle(c.key)}
                />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.label}</span>
                {c.locked && <span className="muted">(locked)</span>}
              </label>
              {!c.locked && (
                <>
                  <button
                    type="button"
                    className="btn secondary"
                    style={{ padding: "2px 6px" }}
                    disabled={i === 0 || columns[i - 1]?.locked}
                    onClick={() => onMove(c.key, -1)}
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn secondary"
                    style={{ padding: "2px 6px" }}
                    disabled={i === columns.length - 1}
                    onClick={() => onMove(c.key, 1)}
                    title="Move down"
                  >
                    ↓
                  </button>
                </>
              )}
            </div>
          ))}
          <button type="button" className="btn secondary" style={{ width: "100%", justifyContent: "center", marginTop: 8 }} onClick={onReset}>
            Reset to default
          </button>
        </div>
      )}
    </div>
  );
}
