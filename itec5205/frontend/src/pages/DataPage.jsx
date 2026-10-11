import { ImportPanel, ImportStatus } from "../features/dataImport/ImportControls";
import { DatabaseIcon } from "../layout/icons";

export default function DataPage() {
  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <div className="icon-badge" style={{ background: "rgba(59,130,246,0.15)", color: "#3b82f6" }}>
          <DatabaseIcon width={18} height={18} />
        </div>
        <div>
          <h3 style={{ margin: 0 }}>Import market data</h3>
          <p className="muted" style={{ margin: 0 }}>
            Price history and fundamentals from Yahoo Finance. Choose what to import and since when price history should start.
          </p>
        </div>
      </div>
      <div className="flex" style={{ marginBottom: 12 }}>
        <ImportStatus />
      </div>
      <ImportPanel />
    </div>
  );
}
