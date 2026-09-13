import PortfoliosPage from "./PortfoliosPage";
import PoolsPage from "./PoolsPage";

export default function PortfolioPage() {
  return (
    <div>
      {/* Primary: the actual asset allocations -- the output of RL (and any manual portfolios). */}
      <PortfoliosPage />

      <hr style={{ border: "none", borderTop: "1px solid var(--color-divider)", margin: "24px 0" }} />

      <h2 style={{ marginBottom: 4 }}>Candidate Pools</h2>
      <p className="muted">Feed one of these into "Find Asset Allocation" (bottom bar) to generate a new portfolio.</p>
      <PoolsPage />
    </div>
  );
}
