import { useCallback, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { apiClient } from "../api/client";
import { ImportPanel, ImportStatus, UNIVERSES } from "../features/dataImport/ImportControls";
import {
  BarChartIcon,
  ClockIcon,
  DatabaseIcon,
  DownloadIcon,
  LightbulbIcon,
  SlidersIcon,
  TrendChartIcon,
  WorkflowIcon,
} from "../layout/icons";
import BackButton from "../layout/BackButton";

const RECENT = 8;

const STATUS = {
  running: { label: "Running", tone: "info" },
  completed: { label: "Completed", tone: "good" },
  completed_with_failures: { label: "Completed*", tone: "warn" },
  stopped: { label: "Stopped", tone: "warn" },
  failed: { label: "Failed", tone: "bad" },
};
const SOURCE = { manual: "Manual", resume: "Resumed", policy: "Policy" };

const fmtInt = (n) => (n == null ? "–" : Number(n).toLocaleString());
const fmtWhen = (iso) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const fmtDate = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "–");

function companiesLabel(run) {
  if (run.scope === "all") {
    const label = (UNIVERSES[run.universe] || UNIVERSES.sp500).label;
    return run.skipped ? `${label} (${run.total} new of ${run.total + run.skipped})` : `${label} (${run.total})`;
  }
  if (run.tickers?.length) return run.tickers.join(", ");
  return `${run.total} companies`;
}

function CardHeader({ icon: Icon, color, title, subtitle, action }) {
  return (
    <div className="card-header">
      <div className="icon-badge" style={{ background: `${color}22`, color }}>
        <Icon width={18} height={18} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        {subtitle && <p className="muted" style={{ margin: 0 }}>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

const TIPS = [
  { icon: DatabaseIcon, color: "#10b981", title: "Data source", text: "Daily prices and fundamentals from Yahoo Finance, for the S&P 500 (503 tickers) or the Russell 3000 (~2,590)." },
  { icon: ClockIcon, color: "#8b5cf6", title: "Time range", text: "Forecasts train on 10 years (~2,515 trading days) by default: import at least 10 years." },
  { icon: BarChartIcon, color: "#f59e0b", title: "Import options", text: "Statistics feed the screener; history and calculated statistics feed charts and forecasts." },
  { icon: TrendChartIcon, color: "#3b82f6", title: "Already imported", text: "\"Skip them\" imports only new companies; \"Catch up if out of date\" refreshes only those behind the last trading day. Set the default in Settings." },
  { icon: WorkflowIcon, color: "#6366f1", title: "Automate it", text: <>Save these options as a <Link to="/criteria/data">Data Criteria</Link> and a policy imports before every run.</> },
];

function Tips() {
  return (
    <div className="card">
      <CardHeader icon={LightbulbIcon} color="#3b82f6" title="Import tips" />
      <div style={{ display: "grid", gap: 10 }}>
        {TIPS.map(({ icon: Icon, color, title, text }) => (
          <div key={title} className="tip-row">
            <div className="icon-badge" style={{ background: `${color}22`, color }}>
              <Icon width={17} height={17} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="tip-title">{title}</div>
              <div className="muted">{text}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OptionChips({ run }) {
  const chips = [
    run.import_history && ["H", "Price history"],
    run.import_statistics && ["S", "Statistics"],
    run.import_calculated_stats && ["C", "Calculated statistics"],
  ].filter(Boolean);
  return (
    <span style={{ display: "inline-flex", gap: 4 }}>
      {chips.map(([k, title]) => (
        <span key={k} className="opt-chip" title={title}>{k}</span>
      ))}
    </span>
  );
}

function RecentImports({ refreshKey }) {
  const [data, setData] = useState({ runs: [], total: 0 });
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    apiClient.get("/api/data/imports", { params: { limit: showAll ? 200 : RECENT } }).then((r) => setData(r.data)).catch(() => {});
  }, [refreshKey, showAll]);

  return (
    <div className="card" style={{ minWidth: 0 }}>
      <CardHeader
        icon={ClockIcon}
        color="#3b82f6"
        title="Recent imports"
        subtitle="Every import, from this page, a resume or a policy run"
        action={
          data.total > RECENT && (
            <button className="btn secondary" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show recent" : `View all (${data.total})`}
            </button>
          )
        }
      />
      {data.runs.length === 0 ? (
        <p className="muted">No imports recorded yet. Imports started from now on are listed here.</p>
      ) : (
        <div style={{ overflowX: "auto", maxHeight: showAll ? 480 : undefined }}>
          <table>
            <thead>
              <tr>
                <th>Date &amp; time</th>
                <th>Companies</th>
                <th style={{ textAlign: "left" }}>Since</th>
                <th style={{ textAlign: "left" }}>Options</th>
                <th style={{ textAlign: "left" }}>Source</th>
                <th style={{ textAlign: "left" }}>Status</th>
                <th title="Daily price rows added by the import (0 = already up to date)">New prices</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {data.runs.map((run) => {
                const st = STATUS[run.status] || { label: run.status, tone: "info" };
                const failedTitle = run.failed_tickers?.length ? `Failed: ${run.failed_tickers.join(", ")}` : run.error || "";
                return (
                  <tr key={run._key}>
                    <td>{fmtWhen(run.created_at)}</td>
                    <td title={companiesLabel(run)} style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>{companiesLabel(run)}</td>
                    <td style={{ textAlign: "left" }}>{run.import_history ? `${run.years} years` : "–"}</td>
                    <td style={{ textAlign: "left" }}><OptionChips run={run} /></td>
                    <td style={{ textAlign: "left" }}>{SOURCE[run.source] || run.source}</td>
                    <td style={{ textAlign: "left" }}>
                      <span className={`status-pill ${st.tone}`} title={failedTitle || undefined}>
                        {st.label}
                        {run.failed ? ` · ${run.failed} failed` : ""}
                        {run.status === "stopped" && run.remaining ? ` · ${run.remaining} left` : ""}
                      </span>
                    </td>
                    <td>{run.status === "running" ? "…" : fmtInt(run.records)}</td>
                    <td>{run.wall_seconds != null ? `${Math.round(run.wall_seconds)} s` : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Summary({ refreshKey }) {
  const [s, setS] = useState(null);

  useEffect(() => {
    apiClient.get("/api/data/summary").then((r) => setS(r.data)).catch(() => {});
  }, [refreshKey]);

  const years = s?.first_date && s?.last_date ? (new Date(s.last_date) - new Date(s.first_date)) / (365.25 * 864e5) : null;
  const tiles = s
    ? [
        {
          icon: DatabaseIcon,
          color: "#10b981",
          value: fmtInt(s.companies),
          label: "Companies imported",
          sub: ["sp500", "russell3000"].map((k) => s.universes?.[k]).filter(Boolean).map((u) => `${u.label} ${fmtInt(u.imported)} / ${fmtInt(u.size)}`).join(" · ") || "companies with data",
        },
        { icon: BarChartIcon, color: "#3b82f6", value: fmtInt(s.price_rows), label: "Daily prices", sub: `across ${s.tickers_with_prices} tickers` },
        { icon: ClockIcon, color: "#8b5cf6", value: years ? `${years.toFixed(1)} years` : "–", label: "History", sub: `${fmtDate(s.first_date)} – ${fmtDate(s.last_date)}` },
        {
          icon: TrendChartIcon,
          color: s.up_to_date === s.tickers_with_prices ? "#16a34a" : "#f59e0b",
          value: `${s.up_to_date} / ${s.tickers_with_prices}`,
          label: "Up to date",
          sub: `through ${fmtDate(s.last_session)}`,
        },
      ]
    : [];

  return (
    <div className="card">
      <CardHeader icon={SlidersIcon} color="#3b82f6" title="What's stored" subtitle="Market data in the database right now" />
      {!s ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <div className="tile-grid">
            {tiles.map(({ icon: Icon, color, value, label, sub }) => (
              <div key={label} className="stat-tile">
                <div className="icon-badge" style={{ background: `${color}22`, color }}>
                  <Icon width={18} height={18} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="stat-value">{value}</div>
                  <div className="stat-label">{label}</div>
                  <div className="muted" style={{ fontSize: "0.75rem" }}>{sub}</div>
                </div>
              </div>
            ))}
          </div>
          {s.last_import?.finished_at && (
            <p className="muted" style={{ marginTop: 10 }}>Last import finished {fmtWhen(s.last_import.finished_at)}.</p>
          )}
        </>
      )}
    </div>
  );
}

export default function DataPage() {
  const importStatus = useSelector((st) => st.dataImport.status);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Reload history and totals when an import starts or finishes.
  useEffect(() => {
    if (["running", "done", "stopped", "error"].includes(importStatus)) refresh();
  }, [importStatus, refresh]);

  return (
    <div>
      <header className="page-header">
        <div className="icon-badge page-header-icon">
          <DownloadIcon width={26} height={26} />
        </div>
        <div style={{ minWidth: 0 }}>
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <span>Data</span>
            <span aria-hidden="true">›</span>
            <span>Market Data</span>
          </nav>
          <h2 style={{ margin: 0 }}>Import market data</h2>
          <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>
            Price history and fundamentals from Yahoo Finance. Choose which companies, what to import, and how far back history should start.
          </p>
        </div>
        <div className="page-header-actions">
          <BackButton />
        </div>
      </header>

      {/* Two independent columns, so a tall side card leaves no gap in the main one. */}
      <div className="data-grid">
        <div className="data-col">
        <div className="card" style={{ minWidth: 0 }}>
          <CardHeader
            icon={DownloadIcon}
            color="#3b82f6"
            title="Import configuration"
            subtitle="Pick the companies, the time range and what to import"
          />
          <div className="flex" style={{ marginBottom: 12 }}>
            <ImportStatus />
          </div>
          <ImportPanel />
        </div>
        <RecentImports refreshKey={refreshKey} />
        </div>
        <div className="data-col">
          <Summary refreshKey={refreshKey} />
          <Tips />
        </div>
      </div>
    </div>
  );
}
