import { useEffect, useRef, useState } from "react";
import { CopyIcon, EditIcon, MoreVerticalIcon, RenameIcon, TrashIcon } from "../layout/icons";

const menuItemStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  textAlign: "left",
  padding: "8px 12px",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  fontSize: "0.85rem",
  color: "var(--color-text-primary)",
};

// `extraItems` ([{label, icon, onClick, disabled}]) go first, e.g. Run / Cancel.
export default function ActionMenu({ onRename, onEdit, onDuplicate, onDelete, extraItems = [] }) {
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
          {extraItems.map(({ label, icon: Icon, onClick, disabled }) => (
            <button
              key={label}
              style={{ ...menuItemStyle, opacity: disabled ? 0.5 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
              disabled={disabled}
              onClick={() => {
                setOpen(false);
                onClick();
              }}
            >
              {Icon && <Icon />} {label}
            </button>
          ))}
          {onRename && (
            <button
              style={menuItemStyle}
              onClick={() => {
                setOpen(false);
                onRename();
              }}
            >
              <RenameIcon /> Rename
            </button>
          )}
          {onEdit && (
            <button
              style={menuItemStyle}
              onClick={() => {
                setOpen(false);
                onEdit();
              }}
            >
              <EditIcon /> Edit
            </button>
          )}
          {onDuplicate && (
            <button
              style={menuItemStyle}
              onClick={() => {
                setOpen(false);
                onDuplicate();
              }}
            >
              <CopyIcon /> Duplicate
            </button>
          )}
          <button
            style={{ ...menuItemStyle, color: "#dc2626" }}
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            <TrashIcon /> Delete
          </button>
        </div>
      )}
    </div>
  );
}
