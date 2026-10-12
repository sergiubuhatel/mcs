import { CloseIcon } from "../layout/icons";

// The dialog grows to fit its content (no inner scrollbar, so dropdowns aren't
// clipped); a dialog taller than the window scrolls with the overlay.
export default function Modal({ isOpen, onClose, title, headerActions, children, maxWidth = 480 }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0" style={{ zIndex: 1000, overflowY: "auto" }}>
      <div className="fixed inset-0" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose} />
      <div
        className="relative flex items-center justify-center"
        style={{
          minHeight: "100%",
          padding: "32px 16px",
          pointerEvents: "none",
        }}
      >
        <div
          className="relative"
          style={{
            zIndex: 1,
            width: "100%",
            maxWidth,
            pointerEvents: "auto",
            background: "var(--color-bg-primary)",
            border: "1px solid var(--color-divider)",
            borderRadius: 10,
            boxShadow: "0 16px 40px rgba(0,0,0,0.25)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 20px",
              borderBottom: "1px solid var(--color-divider)",
            }}
          >
            <h3 style={{ margin: 0 }}>{title}</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {headerActions}
              <button className="close-btn" onClick={onClose} title="Close" aria-label="Close" style={{ position: "static" }}>
                <CloseIcon width={18} height={18} />
              </button>
            </div>
          </div>
          <div style={{ padding: "16px 20px" }}>{children}</div>
        </div>
      </div>
    </div>
  );
}
