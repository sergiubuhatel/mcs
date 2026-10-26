import { useState } from "react";
import { ClockIcon } from "../../layout/icons";

// Stored dates are plain YYYY-MM-DD (US market dates); read them as local
// calendar days so the time zone can't move them by one.
const asDay = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export function fmtDay(iso) {
  return iso ? asDay(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "-";
}

/** Whole calendar days from today to `iso` (negative = in the past). */
export function daysFromToday(iso) {
  if (!iso) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((asDay(iso) - today) / 86400000);
}

export function relativeDays(iso) {
  const n = daysFromToday(iso);
  if (n === null) return "";
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

/** Next release date + "(est.)" when Yahoo hasn't confirmed it. */
export function nextReportLabel(date, confirmed) {
  if (!date) return "-";
  return `${fmtDay(date)}${confirmed === false ? " (est.)" : ""}`;
}

const fmtEps = (v) => (v == null ? "-" : `$${Number(v).toFixed(2)}`);
const surpriseColor = (v) => (v == null || v === 0 ? "var(--color-text-primary)" : v > 0 ? "#16a34a" : "#dc2626");

const SHOWN = 8;

/** Company page: last / next financial results and every stored release. */
export default function FinancialResultsCard({ earnings }) {
  const [all, setAll] = useState(false);
  const summary = earnings?.summary;
  const reports = earnings?.reports || [];
  const rows = all ? reports : reports.slice(0, SHOWN);

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <div className="icon-badge" style={{ background: "rgba(124,58,237,0.15)", color: "#7c3aed" }}>
          <ClockIcon />
        </div>
        <div>
          <h3 style={{ margin: 0 }}>Financial results</h3>
          <span className="muted" style={{ fontSize: "0.8rem" }}>
            {reports.length
              ? `${reports.length} quarterly earnings releases since ${fmtDay(summary?.first_report_date)}`
              : "Earnings release dates and EPS from Yahoo Finance"}
          </span>
        </div>
      </div>

      {!summary ? (
        <p className="muted" style={{ margin: 0 }}>
          Not imported yet. Run an import on the Market Data page with &quot;Import financial results&quot; ticked.
        </p>
      ) : (
        <>
          <div className="filters-grid" style={{ marginBottom: 10 }}>
            <div>
              <strong>Last results</strong>
              <div>{fmtDay(summary.last_report_date)} <span className="muted">{relativeDays(summary.last_report_date)}</span></div>
            </div>
            <div>
              <strong>Next results</strong>
              <div>
                {nextReportLabel(summary.next_report_date, summary.next_confirmed)}{" "}
                <span className="muted">{relativeDays(summary.next_report_date)}</span>
              </div>
            </div>
            <div><strong>Last quarter ended</strong><div>{fmtDay(summary.last_quarter_end)}</div></div>
            <div>
              <strong>Last EPS vs estimate</strong>
              <div>
                {fmtEps(summary.last_eps_reported)} vs {fmtEps(summary.last_eps_estimate)}{" "}
                {summary.last_surprise_pct != null && (
                  <span style={{ color: surpriseColor(summary.last_surprise_pct), fontWeight: 600 }}>
                    ({summary.last_surprise_pct > 0 ? "+" : ""}{summary.last_surprise_pct.toFixed(2)}%)
                  </span>
                )}
              </div>
            </div>
            <div><strong>Next EPS estimate</strong><div>{fmtEps(summary.next_eps_estimate)}</div></div>
          </div>

          {reports.length > 0 && (
            <table style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Release date</th>
                  <th>EPS estimate</th>
                  <th>Reported EPS</th>
                  <th>Surprise</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const upcoming = r.eps_reported == null && daysFromToday(r.date) >= 0;
                  return (
                    <tr key={r.date}>
                      <td style={{ textAlign: "left" }}>
                        {fmtDay(r.date)}
                        {upcoming && <span className="pill" style={{ marginLeft: 8, background: "rgba(59,130,246,0.15)", color: "#3b82f6" }}>Upcoming</span>}
                      </td>
                      <td>{fmtEps(r.eps_estimate)}</td>
                      <td>{fmtEps(r.eps_reported)}</td>
                      <td style={{ color: surpriseColor(r.surprise_pct), fontWeight: 600 }}>
                        {r.surprise_pct == null ? "-" : `${r.surprise_pct > 0 ? "+" : ""}${r.surprise_pct.toFixed(2)}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {reports.length > SHOWN && (
            <button className="btn secondary" style={{ marginTop: 8 }} onClick={() => setAll(!all)}>
              {all ? "Show fewer" : `Show all ${reports.length}`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
