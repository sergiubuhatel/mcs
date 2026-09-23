import { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { deleteRequested, fetchRequested, updateRequested } from "../features/pools/poolsSlice";
import { reset as resetRl } from "../features/rl/rlSlice";
import RLTrainingPanel from "../features/rl/RLTrainingPanel";
import { MoreVerticalIcon } from "../layout/icons";

function ActionMenu({ onEdit, onDelete }) {
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
            className="menu-item"
            style={menuItemStyle}
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
          >
            Edit
          </button>
          <button
            className="menu-item"
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

export default function PoolsPage() {
  const dispatch = useDispatch();
  const { items, loading } = useSelector((s) => s.pools);
  const [activePoolId, setActivePoolId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editTickers, setEditTickers] = useState("");

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
            <col />
            <col style={{ width: 220 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 70 }} />
          </colgroup>
          <thead><tr><th>Name</th><th>Tickers</th><th>Created</th><th>Action</th></tr></thead>
          <tbody>
            {items.map((p) => {
              const isEditing = editingId === p._key;
              return (
                <tr key={p._key}>
                  <td style={{ textAlign: "left" }}>
                    {isEditing ? (
                      <input value={editName} onChange={(e) => setEditName(e.target.value)} style={{ width: "100%" }} />
                    ) : (
                      <a onClick={() => selectPool(p._key)} style={{ cursor: "pointer" }}>{p.name}</a>
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
                      <ActionMenu onEdit={() => startEdit(p)} onDelete={() => dispatch(deleteRequested(p._key))} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {activePool && <RLTrainingPanel key={activePool._key} pool={activePool} />}
    </div>
  );
}
