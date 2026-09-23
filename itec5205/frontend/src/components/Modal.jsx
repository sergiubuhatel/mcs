import { CloseIcon } from "../layout/icons";

export default function Modal({ isOpen, onClose, title, headerActions, children, maxWidth = 480 }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex: 1000 }}>
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose} />
      <div
        className="relative"
        style={{
          zIndex: 1,
          width: "100%",
          maxWidth,
          maxHeight: "85vh",
          overflowY: "auto",
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
            position: "sticky",
            top: 0,
            background: "var(--color-bg-primary)",
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
  );
}
