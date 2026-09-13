import { useState } from "react";
import { useSelector } from "react-redux";
import PredictionPanel from "../features/predictions/PredictionPanel";
import { SearchIcon } from "../layout/icons";

export default function PredictionPage() {
  const lastResultTicker = useSelector((s) => s.predictions.result?.ticker);
  const [ticker, setTicker] = useState(lastResultTicker || "");
  const [activeTicker, setActiveTicker] = useState(lastResultTicker || null);

  const submit = (e) => {
    e.preventDefault();
    if (ticker.trim()) setActiveTicker(ticker.trim().toUpperCase());
  };

  return (
    <div>
      <div className="card">
        <h2>Prediction</h2>
        <p className="muted">LSTM-based short-horizon price forecasts, per ticker — this is the result view for the "Predict Stock Price" action.</p>
        <form onSubmit={submit} style={{ display: "flex", gap: 8 }}>
          <input
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            placeholder="Ticker, e.g. AAPL"
            style={{ flex: 1, padding: "6px 8px", border: "1px solid var(--color-divider)", borderRadius: 5, background: "var(--color-bg-primary)", color: "var(--color-text-primary)" }}
          />
          <button className="btn" type="submit"><SearchIcon /> Load</button>
        </form>
      </div>

      {activeTicker ? (
        <PredictionPanel ticker={activeTicker} />
      ) : (
        <div className="card muted">Enter a ticker above, or use "Predict Stock Price" in the bottom bar.</div>
      )}
    </div>
  );
}
