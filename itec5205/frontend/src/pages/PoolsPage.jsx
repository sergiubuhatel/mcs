import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { createRequested, deleteRequested, fetchRequested, updateRequested } from "../features/pools/poolsSlice";
import { reset as resetRl } from "../features/rl/rlSlice";
import RLTrainingPanel from "../features/rl/RLTrainingPanel";
import ActionMenu from "../components/ActionMenu";
import ConfirmDeleteModal from "../components/ConfirmDeleteModal";
import LoadingSpinner from "../components/LoadingSpinner";

export default function PoolsPage() {
  const dispatch = useDispatch();
  const { items, loading } = useSelector((s) => s.pools);
  const [activePoolId, setActivePoolId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editMode, setEditMode] = useState("full"); // "full" | "rename"
  const [editName, setEditName] = useState("");
  const [editTickers, setEditTickers] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => {
    dispatch(fetchRequested());
  }, [dispatch]);

  const sortedItems = [...items].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const activePool = items.find((p) => p._key === activePoolId);

  const selectPool = (id) => {
    dispatch(resetRl());
    setActivePoolId(id);
  };

  const startEdit = (p) => {
    setEditingId(p._key);
    setEditMode("full");
    setEditName(p.name);
    setEditTickers(p.tickers.join(", "));
  };

  const startRename = (p) => {
    setEditingId(p._key);
    setEditMode("rename");
    setEditName(p.name);
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = (id) => {
    const changes = { id, name: editName.trim() };
    if (editMode === "full") {
      changes.tickers = editTickers
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    }
    dispatch(updateRequested(changes));
    setEditingId(null);
  };

  const confirmDelete = () => {
    dispatch(deleteRequested(deleteTarget._key));
    setDeleteTarget(null);
  };

  const duplicatePool = (p) => {
    dispatch(createRequested({ name: `${p.name} (copy)`, tickers: p.tickers, filters: p.filters }));
  };

  return (
    <div>
      <div className="card">
        <h2>Candidate investment pools</h2>
        <p className="muted">
          Saved from the Screener page. Pick a pool below to run reinforcement learning over it and get a
          recommended low-risk / high-return allocation.
        </p>
        {loading && <LoadingSpinner />}
        {items.length === 0 && !loading && <p className="muted">No pools yet — go to the Screener, select some tickers, and save a pool.</p>}
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
              return (
                <tr key={p._key}>
                  <td style={{ textAlign: "left", maxWidth: 0 }}>
                    {isEditing ? (
                      <input value={editName} onChange={(e) => setEditName(e.target.value)} style={{ width: "100%" }} />
                    ) : (
                      <a
                        onClick={() => selectPool(p._key)}
                        title={p.name}
                        style={{ cursor: "pointer", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      >
                        {p.name}
                      </a>
                    )}
                  </td>
                  <td style={{ textAlign: "left", maxWidth: 0 }}>
                    {isEditing && editMode === "full" ? (
                      <input
                        value={editTickers}
                        onChange={(e) => setEditTickers(e.target.value)}
                        style={{ width: "100%" }}
                        placeholder="Comma-separated tickers"
                      />
                    ) : (
                      <span
                        title={p.tickers.join(", ")}
                        style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      >
                        {p.tickers.join(", ")}
                      </span>
                    )}
                  </td>
                  <td>{new Date(p.created_at).toLocaleDateString()}</td>
                  <td>
                    {isEditing ? (
                      <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                        <button className="btn" onClick={() => saveEdit(p._key)}>Save</button>
                        <button className="btn secondary" onClick={cancelEdit}>Cancel</button>
                      </div>
                    ) : (
                      <ActionMenu
                        onRename={() => startRename(p)}
                        onEdit={() => startEdit(p)}
                        onDuplicate={() => duplicatePool(p)}
                        onDelete={() => setDeleteTarget(p)}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {activePool && <RLTrainingPanel key={activePool._key} pool={activePool} />}

      <ConfirmDeleteModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        itemName={deleteTarget?.name}
        title="Delete pool"
      />
    </div>
  );
}
