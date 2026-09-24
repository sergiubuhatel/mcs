import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { createRequested, deleteRequested, fetchRequested, updateRequested } from "../features/portfolios/portfoliosSlice";
import ManualPortfolioForm from "../features/portfolios/ManualPortfolioForm";
import ActionMenu from "../components/ActionMenu";
import ConfirmDeleteModal from "../components/ConfirmDeleteModal";
import Modal from "../components/Modal";
import LoadingSpinner from "../components/LoadingSpinner";
import { PlusIcon, SaveIcon } from "../layout/icons";

export default function PortfoliosPage() {
  const dispatch = useDispatch();
  const { items, loading, creating } = useSelector((s) => s.portfolios);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [buildOpen, setBuildOpen] = useState(false);

  useEffect(() => {
    dispatch(fetchRequested());
  }, [dispatch]);

  const startRename = (p) => {
    setEditingId(p._key);
    setEditName(p.name);
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = (id) => {
    dispatch(updateRequested({ id, name: editName.trim() }));
    setEditingId(null);
  };

  const confirmDelete = () => {
    dispatch(deleteRequested(deleteTarget._key));
    setDeleteTarget(null);
  };

  const duplicatePortfolio = (p) => {
    dispatch(
      createRequested({
        name: `${p.name} (copy)`,
        holdings: p.holdings.map((h) => ({ ticker: h.ticker, weight: h.weight })),
        method: p.method,
      })
    );
  };

  const sortedItems = [...items].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  return (
    <div>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <button
            className="close-btn"
            style={{ position: "static" }}
            onClick={() => setBuildOpen(true)}
            title="Build a manual portfolio"
            aria-label="Build a manual portfolio"
          >
            <PlusIcon width={18} height={18} />
          </button>
        </div>
        {loading && <LoadingSpinner />}
        {items.length === 0 && !loading && <p className="muted">No portfolios yet.</p>}
        <table style={{ tableLayout: "fixed", width: "100%" }}>
          <colgroup>
            <col style={{ width: 400 }} />
            <col />
            <col style={{ width: 110 }} />
            <col style={{ width: 70 }} />
          </colgroup>
          <thead><tr><th>Name</th><th>Tickers</th><th>Created</th><th>Action</th></tr></thead>
          <tbody>
            {sortedItems.map((p) => {
              const isEditing = editingId === p._key;
              const tickers = p.holdings.map((h) => h.ticker).join(", ");
              return (
                <tr key={p._key}>
                  <td style={{ textAlign: "left", maxWidth: 0 }}>
                    {isEditing ? (
                      <input value={editName} onChange={(e) => setEditName(e.target.value)} style={{ width: "100%" }} />
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
                        <Link
                          to={`/portfolios/${p._key}`}
                          title={p.name}
                          style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}
                        >
                          {p.name}
                        </Link>
                      </div>
                    )}
                  </td>
                  <td style={{ textAlign: "left", maxWidth: 0 }}>
                    <span
                      title={tickers}
                      style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      {tickers}
                    </span>
                  </td>
                  <td>{new Date(p.created_at).toLocaleDateString()}</td>
                  <td>
                    {isEditing ? (
                      <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                        <button className="btn" onClick={() => saveEdit(p._key)}>Save</button>
                        <button className="btn secondary" onClick={cancelEdit}>Cancel</button>
                      </div>
                    ) : (
                      <ActionMenu onRename={() => startRename(p)} onDuplicate={() => duplicatePortfolio(p)} onDelete={() => setDeleteTarget(p)} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ConfirmDeleteModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        itemName={deleteTarget?.name}
        title="Delete portfolio"
      />

      <Modal
        isOpen={buildOpen}
        onClose={() => setBuildOpen(false)}
        title="Build a manual portfolio"
        headerActions={
          <button
            className="close-btn"
            style={{ position: "static", opacity: creating ? 0.5 : 1, cursor: creating ? "not-allowed" : "pointer" }}
            type="submit"
            form="manual-portfolio-form"
            disabled={creating}
            title="Save"
            aria-label="Save"
          >
            <SaveIcon width={18} height={18} />
          </button>
        }
      >
        <ManualPortfolioForm onDone={() => setBuildOpen(false)} />
      </Modal>
    </div>
  );
}
