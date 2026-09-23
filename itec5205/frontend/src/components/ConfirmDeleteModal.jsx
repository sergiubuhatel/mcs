import Modal from "./Modal";
import { TrashIcon } from "../layout/icons";

export default function ConfirmDeleteModal({
  isOpen,
  onClose,
  onConfirm,
  itemName,
  title = "Confirm deletion",
  confirmLabel = "Delete",
}) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} maxWidth={440}>
      <p style={{ margin: 0 }}>
        Are you sure you want to {confirmLabel.toLowerCase()} "{itemName}"? This can't be undone.
      </p>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
        <button className="btn danger" onClick={onConfirm}>
          <TrashIcon /> {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
