import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { deleteRequested, fetchRequested } from "../features/pools/poolsSlice";
import { reset as resetRl } from "../features/rl/rlSlice";
import RLTrainingPanel from "../features/rl/RLTrainingPanel";

export default function PoolsPage() {
  const dispatch = useDispatch();
  const { items, loading } = useSelector((s) => s.pools);
  const [activePoolId, setActivePoolId] = useState(null);

  useEffect(() => {
    dispatch(fetchRequested());
  }, [dispatch]);

  const activePool = items.find((p) => p._key === activePoolId);

  const selectPool = (id) => {
    dispatch(resetRl());
    setActivePoolId(id);
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
        <table>
          <thead><tr><th>Name</th><th>Tickers</th><th>Created</th><th></th></tr></thead>
          <tbody>
            {items.map((p) => (
              <tr key={p._key}>
                <td style={{ textAlign: "left" }}>
                  <a onClick={() => selectPool(p._key)} style={{ cursor: "pointer" }}>{p.name}</a>
                </td>
                <td style={{ textAlign: "left" }}>{p.tickers.join(", ")}</td>
                <td>{new Date(p.created_at).toLocaleDateString()}</td>
                <td><button className="btn danger" onClick={() => dispatch(deleteRequested(p._key))}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {activePool && <RLTrainingPanel key={activePool._key} pool={activePool} />}
    </div>
  );
}
