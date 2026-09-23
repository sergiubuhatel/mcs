import { useEffect, useRef, useState } from "react";
import { MoreVerticalIcon } from "../layout/icons";

const menuItemStyle = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "8px 12px",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  fontSize: "0.85rem",
  color: "var(--color-text-primary)",
};

export default function ActionMenu({ onEdit, onDelete }) {
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
      <button
        className="btn secondary"
        onClick={() => setOpen((o) => !o)}
        title="Actions"
        aria-label="Actions"
        style={{ padding: "4px 8px" }}
      >
        <MoreVerticalIcon />
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 4px)",
            zIndex: 10,
            minWidth: 120,
            background: "var(--color-bg-secondary)",
            border: "1px solid var(--color-divider)",
            borderRadius: 6,
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            overflow: "hidden",
          }}
        >
          <button
            style={menuItemStyle}
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
          >
            Edit
          </button>
          <button
            style={{ ...menuItemStyle, color: "#dc2626" }}
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
