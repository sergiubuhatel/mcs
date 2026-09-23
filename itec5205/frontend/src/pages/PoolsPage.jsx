import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { deleteRequested, fetchRequested, updateRequested } from "../features/pools/poolsSlice";
import { reset as resetRl } from "../features/rl/rlSlice";
import RLTrainingPanel from "../features/rl/RLTrainingPanel";
import ActionMenu from "../components/ActionMenu";
import ConfirmDeleteModal from "../components/ConfirmDeleteModal";

export default function PoolsPage() {
  const dispatch = useDispatch();
  const { items, loading } = useSelector((s) => s.pools);
  const [activePoolId, setActivePoolId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editTickers, setEditTickers] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => {
    dispatch(fetchRequested());
  }, [dispatch]);

  const activePool = items.find((p) => p._key === activePoolId);

  const selectPool = (id) => {
    dispatch(resetRl());
    setActivePoolId(id);
  };

  const startEdit = (p) => {
    setEditingId(p._key);
    setEditName(p.name);
    setEditTickers(p.tickers.join(", "));
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = (id) => {
    const tickers = editTickers
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    dispatch(updateRequested({ id, name: editName.trim(), tickers }));
    setEditingId(null);
  };

  const confirmDelete = () => {
    dispatch(deleteRequested(deleteTarget._key));
    setDeleteTarget(null);
  };

  return (
    <div>
      <div className="card">
        <h2>Candidate investment pools</h2>
        <p className="muted">
          Saved from the Screener page. Pick a pool below to run reinforcement learning over it and get a
          recommended low-risk / high-return allocation.
        </p>
        {loading && <p className="muted">Loading...</p>}
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
            {items.map((p) => {
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
                    {isEditing ? (
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
                      <ActionMenu onEdit={() => startEdit(p)} onDelete={() => setDeleteTarget(p)} />
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
