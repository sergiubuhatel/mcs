import { CloseIcon, TrashIcon } from "../layout/icons";

export default function ConfirmDeleteModal({
  isOpen,
  onClose,
  onConfirm,
  itemName,
  title = "Confirm deletion",
  confirmLabel = "Delete",
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex: 1000 }}>
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose} />
      <div
        className="relative"
        style={{
          zIndex: 1,
          minWidth: 340,
          maxWidth: 440,
          background: "var(--color-bg-primary)",
          border: "1px solid var(--color-divider)",
          borderRadius: 10,
          boxShadow: "0 16px 40px rgba(0,0,0,0.25)",
          overflow: "hidden",
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
          <button className="close-btn" onClick={onClose} title="Close" aria-label="Close" style={{ position: "static" }}>
            <CloseIcon />
          </button>
        </div>
        <div style={{ padding: "16px 20px" }}>
          <p style={{ margin: 0 }}>
            Are you sure you want to {confirmLabel.toLowerCase()} "{itemName}"? This can't be undone.
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
            <button className="btn danger" onClick={onConfirm}>
              <TrashIcon /> {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
