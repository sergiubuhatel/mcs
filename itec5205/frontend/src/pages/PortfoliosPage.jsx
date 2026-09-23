import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { deleteRequested, fetchRequested, updateRequested } from "../features/portfolios/portfoliosSlice";
import ManualPortfolioForm from "../features/portfolios/ManualPortfolioForm";
import ActionMenu from "../components/ActionMenu";

export default function PortfoliosPage() {
  const dispatch = useDispatch();
  const { items, loading } = useSelector((s) => s.portfolios);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");

  useEffect(() => {
    dispatch(fetchRequested());
  }, [dispatch]);

  const startEdit = (p) => {
    setEditingId(p._key);
    setEditName(p.name);
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = (id) => {
    dispatch(updateRequested({ id, name: editName.trim() }));
    setEditingId(null);
  };

  return (
    <div>
      <ManualPortfolioForm />

      <div className="card">
        <h2>Saved portfolios</h2>
        {loading && <p className="muted">Loading...</p>}
        {items.length === 0 && !loading && <p className="muted">No portfolios yet.</p>}
        <table style={{ tableLayout: "fixed", width: "100%" }}>
          <colgroup>
            <col style={{ width: 400 }} />
            <col />
            <col style={{ width: 110 }} />
            <col style={{ width: 70 }} />
          </colgroup>
          <thead><tr><th>Name</th><th>Holdings</th><th>Created</th><th>Action</th></tr></thead>
          <tbody>
            {items.map((p) => {
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
                      <ActionMenu onEdit={() => startEdit(p)} onDelete={() => dispatch(deleteRequested(p._key))} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
