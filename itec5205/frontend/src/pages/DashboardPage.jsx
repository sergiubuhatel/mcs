// Home page: who is signed in, what page each user has open, and everything
// they did -- imports, forecasts, RL, workflows... -- with the live status of
// the jobs they started, plus totals with 14-day trends, the newest portfolio
// against the S&P 500 and the latest workflow run.
// Data: GET /api/activity/dashboard and /api/activity/overview, refetched
// whenever the backend pushes `dashboard_changed` over Socket.IO (room
// "dashboard": sign-ins/outs, page changes, actions, job progress).
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiClient } from "../api/client";
import { getSocket, joinRoom, leaveRoom } from "../api/socket";
import { PageHeader } from "../components/PageParts";
import LoadingSpinner from "../components/LoadingSpinner";
import RangePicker from "../components/RangePicker";
import { tooltipProps } from "../utils/chartTheme";
import { filterByInterval, rangeLabel } from "../utils/dateRanges";
import {
  CheckCircleIcon,
  ClockIcon,
  DatabaseIcon,
  GridIcon,
  LayersIcon,
  PieChartIcon,
  PlayIcon,
  PlusIcon,
  SearchIcon,
  TrendChartIcon,
  UserIcon,
  WorkflowIcon,
  XCircleIcon,
} from "../layout/icons";

// Fallback only: users going offline by timeout (no heartbeat) send no event.
const POLL_MS = 15000;
const OVERVIEW_POLL_MS = 60000;
const OVERVIEW_MIN_GAP_MS = 10000; // job progress pings come every 2 s
const ROOM = "dashboard";
const RECENT_JOBS = 8;
const TREND_NOUN = { Companies: "imports", "Stock pools": "pools created", Portfolios: "portfolios created", "Jobs running": "jobs started" };

// What page a user has open (heartbeat path -> sidebar name).
const PAGES = [
  [/^\/$/, "Dashboard"],
  [/^\/screener/, "Stock Screener"],
  [/^\/data/, "Market Data"],
  [/^\/criteria\/data/, "Data Filters"],
  [/^\/criteria\/screen/, "Screening Criteria"],
  [/^\/criteria\/prediction/, "Forecast Settings"],
  [/^\/criteria\/portfolio/, "Portfolio Constraints"],
  [/^\/pools/, "Stock Pools"],
  [/^\/prediction/, "Price Forecasts"],
  [/^\/portfolio$/, "Portfolios"],
  [/^\/portfolios\//, "Portfolio details"],
  [/^\/companies\/([^/]+)/, "Company"],
  [/^\/workflows/, "Workflows"],
  [/^\/orders/, "Order Calculator"],
  [/^\/import-portfolio/, "Import Portfolio"],
  [/^\/combine-portfolios/, "Portfolio of Portfolios"],
  [/^\/settings/, "Settings"],
];

function pageName(path) {
  if (!path) return "–";
  for (const [re, name] of PAGES) {
    const m = path.match(re);
    if (m) return m[1] ? `${name} ${decodeURIComponent(m[1]).toUpperCase()}` : name;
  }
  return path;
}

const KINDS = {
  import: { label: "Import", color: "#16a34a", icon: DatabaseIcon },
  forecast: { label: "Forecast", color: "#0891b2", icon: TrendChartIcon },
  rl: { label: "RL", color: "#dc2626", icon: PieChartIcon },
  workflow: { label: "Workflow", color: "#6366f1", icon: WorkflowIcon },
  pool: { label: "Pools", color: "#3b82f6", icon: LayersIcon },
  portfolio: { label: "Portfolios", color: "#d97706", icon: PieChartIcon },
  trading: { label: "Trading", color: "#0d9488", icon: GridIcon },
  settings: { label: "Settings", color: "#64748b", icon: GridIcon },
  backup: { label: "Database", color: "#b91c1c", icon: DatabaseIcon },
};
const MAIN_KINDS = ["import", "forecast", "rl", "workflow"];

const STATUS = {
  running: ["info", "Running"],
  queued: ["grey", "Queued"],
  done: ["good", "Completed"],
  succeeded: ["good", "Completed"],
  failed: ["bad", "Failed"],
  stopped: ["warn", "Stopped"],
  cancelled: ["warn", "Cancelled"],
  skipped: ["grey", "Skipped"],
  unknown: ["grey", "Finished"],
};

const AVATAR_COLORS = ["#6366f1", "#0891b2", "#d97706", "#db2777", "#16a34a", "#7c3aed"];

function ago(iso) {
  if (!iso) return "–";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

function duration(seconds) {
  if (seconds == null) return "–";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

const fmtTime = (iso) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const fmtPct = (v, signed = false) => (v == null ? "–" : `${signed && v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`);
const fmtInt = (n) => (n == null ? "–" : Number(n).toLocaleString());
const signColor = (v) => (v == null || v === 0 ? undefined : v > 0 ? "#16a34a" : "#dc2626");

function roleOf(roles = []) {
  if (roles.includes("installer")) return "Installer";
  if (roles.includes("admin")) return "Admin";
  if (roles.includes("operator")) return "Operator";
  return "Guest";
}

function StatusPill({ status, percent }) {
  if (!status) return <span className="muted">–</span>;
  const [cls, label] = STATUS[status] || ["grey", status];
  return (
    <span className={`status-pill ${cls}`}>
      {label}
      {status === "running" && percent != null ? ` · ${percent}%` : ""}
    </span>
  );
}

function KindTag({ kind }) {
  const k = KINDS[kind] || { label: kind, color: "#64748b", icon: GridIcon };
  const Icon = k.icon;
  return (
    <span className="kind-tag" style={{ color: k.color, background: `${k.color}1f` }}>
      <Icon width={13} height={13} /> {k.label}
    </span>
  );
}

function Avatar({ name, online }) {
  const text = name || "?";
  const color = AVATAR_COLORS[[...text].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
  return (
    <span className="avatar" style={{ background: color }}>
      {text.charAt(0).toUpperCase()}
      <span className={`presence-dot ${online ? "online" : ""}`} />
    </span>
  );
}

function CardHeader({ icon: Icon, color, title, subtitle, actions }) {
  return (
    <div className="card-header" style={{ flexWrap: "wrap" }}>
      <div className="icon-badge" style={{ background: `${color}22`, color }}>
        <Icon width={18} height={18} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        {subtitle && <p className="muted" style={{ margin: 0 }}>{subtitle}</p>}
      </div>
      {actions && <div className="toolbar">{actions}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ KPI tiles

// `trend`: [{day, n}] for the last 14 days (imports / pools / portfolios / jobs started).
function KpiTile({ icon: Icon, color, label, value, sub, trend }) {
  const total = (trend || []).reduce((a, d) => a + d.n, 0);
  return (
    <div className="stat-card kpi-card">
      <div className="icon-badge stat-card-icon" style={{ background: `${color}22`, color }}>
        <Icon width={24} height={24} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="stat-card-label">{label}</div>
        <div className="stat-card-value">{value}</div>
        <div className="muted stat-card-sub">{sub}</div>
      </div>
      {trend && (
        <div className="kpi-spark" title={`Last ${trend.length} days: ${total} ${TREND_NOUN[label]}`}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trend} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`spark-${label}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="n" stroke={color} strokeWidth={2} fill={`url(#spark-${label})`} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------- portfolio performance

// Line styles: the portfolio is the app's fixed chart blue, the baselines
// are dashed so the portfolio stands out.
const LINE_STYLE = {
  portfolio: { stroke: "#2563eb", strokeWidth: 2.5 },
  equal: { stroke: "#a855f7", strokeWidth: 1.8, strokeDasharray: "2 3" },
  SPY: { stroke: "#f59e0b", strokeWidth: 1.8, strokeDasharray: "6 4" },
  DIA: { stroke: "#94a3b8", strokeWidth: 1.8, strokeDasharray: "6 4" },
};

// Total return, volatility, Sharpe (no risk-free rate) and max drawdown of a
// value series, annualized from daily values.
function seriesStats(values) {
  if (values.length < 2) return {};
  const daily = values.slice(1).map((v, i) => v / values[i] - 1);
  const mean = daily.reduce((a, r) => a + r, 0) / daily.length;
  const sd = Math.sqrt(daily.reduce((a, r) => a + (r - mean) ** 2, 0) / Math.max(daily.length - 1, 1));
  const vol = sd * Math.sqrt(252);
  let peak = values[0];
  let drawdown = 0;
  for (const v of values) {
    peak = Math.max(peak, v);
    drawdown = Math.min(drawdown, v / peak - 1);
  }
  return { total_return: values[values.length - 1] / values[0] - 1, volatility: vol, sharpe: vol ? (mean * 252) / vol : null, max_drawdown: drawdown };
}

function PerformanceCard({ portfolio }) {
  const [range, setRange] = useState("1Y");
  // The range picked, every line rebased to 100 on its first day.
  const { series, stats } = useMemo(() => {
    if (!portfolio) return { series: [], stats: {} };
    const rows = filterByInterval(portfolio.series, range);
    const keys = portfolio.lines.map((l) => l.key);
    const base = Object.fromEntries(keys.map((k) => [k, rows[0]?.[k]]));
    const rebased = rows.map((r) => ({ date: r.date, ...Object.fromEntries(keys.map((k) => [k, base[k] ? (100 * r[k]) / base[k] : null])) }));
    return { series: rebased, stats: Object.fromEntries(keys.map((k) => [k, seriesStats(rebased.map((r) => r[k]))])) };
  }, [portfolio, range]);
  if (!portfolio) {
    return (
      <div className="card">
        <CardHeader icon={TrendChartIcon} color="#2563eb" title="Portfolio performance" subtitle="No portfolio yet." />
      </div>
    );
  }
  const { lines } = portfolio;
  const rows = [
    ["Total return", "total_return", (v) => fmtPct(v, true), true],
    ["Volatility", "volatility", (v) => fmtPct(v), false],
    ["Sharpe ratio", "sharpe", (v) => (v == null ? "–" : v.toFixed(2)), false],
    ["Max drawdown", "max_drawdown", (v) => fmtPct(v), true],
  ];
  const short = { portfolio: "Portfolio", equal: "Equal wt.", SPY: "S&P 500", DIA: "Dow" };
  return (
    <div className="card">
      <CardHeader
        icon={TrendChartIcon}
        color="#2563eb"
        title={`Portfolio performance · ${rangeLabel(range)}`}
        subtitle={
          <>
            Newest portfolio, <Link to={`/portfolios/${portfolio.id}`}>{portfolio.name}</Link> ({portfolio.holdings} holdings), vs the same
            stocks equally weighted, the S&amp;P 500 (SPY) and the Dow (DIA), all rebased to 100.
          </>
        }
      />
      <div style={{ marginBottom: 8 }}>
        <RangePicker section="general" value={range} onChange={setRange} />
      </div>
      <div className="perf-body">
        <div className="perf-chart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
              <CartesianGrid stroke="var(--color-divider)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }}
                tickFormatter={(d) => new Date(`${d}T12:00`).toLocaleDateString([], series.length > 150 ? { month: "short", year: "2-digit" } : { month: "short", day: "numeric" })}
                minTickGap={40}
              />
              <YAxis tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }} domain={["auto", "auto"]} width={44} />
              <Tooltip {...tooltipProps} formatter={(v, name) => [v == null ? "–" : Number(v).toFixed(2), name]} />
              <Legend wrapperStyle={{ fontSize: "0.78rem" }} />
              {lines.map(({ key, label }) => (
                <Line key={key} type="monotone" dataKey={key} name={label} dot={false} isAnimationActive={false} {...(LINE_STYLE[key] || {})} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <table className="perf-stats compact">
          <thead>
            <tr>
              <th style={{ cursor: "default" }} />
              {lines.map(({ key, label }) => (
                <th key={key} style={{ cursor: "default", color: LINE_STYLE[key]?.stroke }} title={label}>{short[key] || key}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, stat, fmt, colored]) => (
              <tr key={stat}>
                <td>{label}</td>
                {lines.map(({ key }) => (
                  <td key={key} style={{ fontWeight: key === "portfolio" ? 700 : undefined, color: colored ? signColor(stats[key]?.[stat]) : undefined }}>
                    {fmt(stats[key]?.[stat])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- workflow run

const STEPS = [
  ["data", "Data import", (s) => (s.imported != null ? `${fmtInt(s.imported)} imported, ${fmtInt(s.up_to_date)} up to date` : null)],
  ["screen", "Fundamental screening", (s) => (s.tickers != null ? `${fmtInt(s.tickers)} stocks passed` : null)],
  ["forecast", "Price forecasting (LSTM + ARIMA)", (s) => (s.passed != null ? `${fmtInt(s.passed)} stocks with a rising forecast` : null)],
  ["portfolio", "Portfolio allocation (RL)", (s) => (s.holdings != null ? `${fmtInt(s.holdings)} holdings` : null)],
];

function StepIcon({ status, index }) {
  if (status === "done") return <CheckCircleIcon width={20} height={20} style={{ color: "#16a34a" }} />;
  if (status === "failed") return <XCircleIcon width={20} height={20} style={{ color: "#dc2626" }} />;
  if (status === "running") return <ClockIcon width={20} height={20} style={{ color: "#2563eb" }} />;
  return <span className="muted" style={{ fontSize: "0.8rem" }}>{index}</span>;
}

function WorkflowCard({ run }) {
  const navigate = useNavigate();
  const actions = (
    <button className="btn" onClick={() => navigate("/workflows")}>
      <PlayIcon width={14} height={14} /> Run a workflow
    </button>
  );
  if (!run) {
    return (
      <div className="card">
        <CardHeader icon={WorkflowIcon} color="#6366f1" title="Latest workflow run" subtitle="No workflow has run yet." actions={actions} />
      </div>
    );
  }
  const steps = run.steps || {};
  return (
    <div className="card">
      <CardHeader
        icon={WorkflowIcon}
        color="#6366f1"
        title="Latest workflow run"
        subtitle={`Screening → forecasting → RL allocation · started ${ago(run.created_at)}${run.wall_seconds ? `, took ${duration(run.wall_seconds)}` : ""}`}
        actions={actions}
      />
      <div className="wf-name" title={run.workflow_name}>
        <StatusPill status={run.status} percent={run.percent} /> {run.workflow_name}
      </div>
      <ol className="wf-steps">
        {STEPS.map(([key, label, summary], i) => {
          const step = steps[key] || {};
          const status = step.status || (run.step === key && run.status === "running" ? "running" : undefined);
          return (
            <li key={key} className={`wf-step ${status || "pending"}`}>
              <span className="wf-step-num">{i + 1}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="wf-step-title">{label}</div>
                <div className="muted wf-step-sub">
                  {summary(step) || (status === "skipped" ? "Skipped" : status ? "" : "Not reached")}
                </div>
              </div>
              <StepIcon status={status} index={i + 1} />
            </li>
          );
        })}
      </ol>
      {run.message && <p className="muted" style={{ margin: "8px 0 0", fontSize: "0.8rem" }}>{run.message}</p>}
    </div>
  );
}

// -------------------------------------------------------------------- page

export default function DashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState(null);
  const [userFilter, setUserFilter] = useState(null);
  const [kindFilter, setKindFilter] = useState("all");
  const lastOverview = useRef(0);

  useEffect(() => {
    let alive = true;
    const load = () =>
      apiClient
        .get("/api/activity/dashboard")
        .then((r) => {
          if (!alive) return;
          setData(r.data);
          setError(null);
        })
        .catch((e) => alive && setError(e.response?.data?.error || e.message)); // keep polling
    const loadOverview = (force = false) => {
      if (!force && Date.now() - lastOverview.current < OVERVIEW_MIN_GAP_MS) return;
      lastOverview.current = Date.now();
      apiClient
        .get("/api/activity/overview")
        .then((r) => alive && setOverview(r.data))
        .catch(() => {});
    };
    // Bursts of events (job progress) -> one fetch.
    let timer = null;
    const onChange = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        load();
        loadOverview();
      }, 300);
    };
    const socket = getSocket();
    const join = () => joinRoom(ROOM); // again after every reconnect
    socket.on("connect", join);
    socket.on("dashboard_changed", onChange);
    if (socket.connected) join();

    load();
    loadOverview(true);
    const id = setInterval(load, POLL_MS);
    const idOverview = setInterval(() => loadOverview(true), OVERVIEW_POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
      clearInterval(idOverview);
      clearTimeout(timer);
      socket.off("connect", join);
      socket.off("dashboard_changed", onChange);
      leaveRoom(ROOM);
    };
  }, []);

  const users = data?.users || [];
  const allActivity = data?.activity || [];
  const activity = useMemo(
    () =>
      allActivity.filter(
        (a) =>
          (!userFilter || a.user_id === userFilter) &&
          (kindFilter === "all" || (kindFilter === "other" ? !MAIN_KINDS.includes(a.kind) : a.kind === kindFilter))
      ),
    [allActivity, userFilter, kindFilter]
  );
  const jobs = allActivity.filter((a) => a.job).slice(0, RECENT_JOBS);
  const stats = data?.stats || {};
  const online = users.filter((u) => u.online);
  const totals = overview?.totals || {};
  const trends = overview?.trends || {};
  const workers = overview?.workers;
  const selectedUser = users.find((u) => u.id === userFilter);
  const jobCount = (u) => MAIN_KINDS.reduce((n, k) => n + (u.counts[k] || 0), 0);

  const systemPill = workers && (
    <span className={`system-pill ${workers.online ? "ok" : "down"}`} title={workers.names.length ? `Workers: ${workers.names.join(", ")}` : "No worker answered"}>
      <span className="presence-dot online" style={workers.online ? undefined : { background: "#dc2626", boxShadow: "none" }} />
      {workers.online ? `System online · ${workers.online} workers` : "Workers offline"}
    </span>
  );

  return (
    <div>
      <PageHeader
        icon={GridIcon}
        color="#6366f1"
        title="Dashboard"
        description="Who is signed in, what each user is doing, the jobs running and the latest results."
        actions={
          <>
            {systemPill}
            <button className="btn" onClick={() => navigate("/workflows")} title="Workflows: screen, forecast and build a portfolio in one run">
              <PlusIcon width={15} height={15} /> New workflow
            </button>
          </>
        }
      />

      <div className="stat-row kpi-row">
        <KpiTile icon={DatabaseIcon} color="#2563eb" label="Companies" value={fmtInt(totals.companies)} sub="Imported" trend={trends.imports} />
        <KpiTile icon={LayersIcon} color="#16a34a" label="Stock pools" value={fmtInt(totals.pools)} sub="Screened" trend={trends.pools} />
        <KpiTile icon={PieChartIcon} color="#a855f7" label="Portfolios" value={fmtInt(totals.portfolios)} sub="Saved" trend={trends.portfolios} />
        <KpiTile
          icon={PlayIcon}
          color="#f97316"
          label="Jobs running"
          value={stats.running ?? "–"}
          sub={`${stats.online ?? 0} online`}
          trend={trends.jobs}
        />
      </div>

      {error && <p className="error-text">Could not load the dashboard: {error}</p>}
      {!data && !error && <LoadingSpinner />}

      {overview && (
        <div className="dash-row">
          <PerformanceCard portfolio={overview.portfolio} />
          <WorkflowCard run={overview.workflow_run} />
        </div>
      )}

      {data && (
        <>
          <div className="dash-row">
            <div className="card">
              <CardHeader icon={PlayIcon} color="#2563eb" title="Recent jobs" subtitle="Imports, forecasts, RL and workflow runs, with their live status." />
              {jobs.length === 0 ? (
                <p className="muted">No jobs yet.</p>
              ) : (
                <table className="compact" style={{ tableLayout: "fixed", width: "100%" }}>
                  <colgroup>
                    <col style={{ width: 110 }} />
                    <col />
                    <col style={{ width: 120 }} />
                    <col style={{ width: 75 }} />
                    <col style={{ width: 110 }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th style={{ cursor: "default" }}>Type</th>
                      <th style={{ cursor: "default" }}>Job</th>
                      <th style={{ cursor: "default" }}>Status</th>
                      <th style={{ cursor: "default" }}>Duration</th>
                      <th style={{ cursor: "default" }}>User</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((a) => (
                      <tr key={a._key}>
                        <td><KindTag kind={a.kind} /></td>
                        <td style={{ overflow: "hidden", textOverflow: "ellipsis" }} title={`${a.action}${a.details ? ` · ${a.details}` : ""} · ${new Date(a.created_at).toLocaleString()}`}>
                          {a.details || a.action}
                          <div className="muted" style={{ fontSize: "0.72rem" }}>{fmtTime(a.created_at)}</div>
                        </td>
                        <td><StatusPill status={a.status} percent={a.percent} /></td>
                        <td>
                          {a.status === "running" || a.status === "queued"
                            ? duration((Date.now() - new Date(a.created_at).getTime()) / 1000)
                            : duration(a.duration_seconds)}
                        </td>
                        <td style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{a.name || a.username}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="card">
              <CardHeader
                icon={UserIcon}
                color="#16a34a"
                title="Users"
                subtitle={`${online.length} online · the page each one has open, live. Click a user to see only their activity.`}
              />
              {users.length === 0 ? (
                <p className="muted">Nobody has signed in yet.</p>
              ) : (
                <table className="compact users-table" style={{ tableLayout: "fixed", width: "100%" }}>
                  <colgroup>
                    <col />
                    <col style={{ width: 72 }} />
                    <col style={{ width: 120 }} />
                    <col style={{ width: 82 }} />
                    <col style={{ width: 42 }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th style={{ cursor: "default" }}>Name</th>
                      <th style={{ cursor: "default", textAlign: "left" }}>Role</th>
                      <th style={{ cursor: "default", textAlign: "left" }}>Current page</th>
                      <th style={{ cursor: "default" }}>Last activity</th>
                      <th style={{ cursor: "default" }} title="Jobs started (running now in blue)">Jobs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr
                        key={u.id}
                        className={u.id === userFilter ? "selected" : ""}
                        onClick={() => setUserFilter(u.id === userFilter ? null : u.id)}
                        title={`${u.username}${u.online ? ` · signed in ${ago(u.signed_in_at)}` : ""}`}
                      >
                        <td style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                            <Avatar name={u.name || u.username} online={u.online} />
                            {u.name || u.username}
                          </span>
                        </td>
                        <td style={{ textAlign: "left" }}>{roleOf(u.roles)}</td>
                        <td style={{ textAlign: "left", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {u.online ? pageName(u.page) : <span className="muted">Offline</span>}
                        </td>
                        <td>{u.online ? "now" : ago(u.last_seen)}</td>
                        <td>
                          {u.running > 0 ? <span className="status-pill info">{u.running}</span> : jobCount(u)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="card">
            <CardHeader
              icon={ClockIcon}
              color="#d97706"
              title="Activity"
              subtitle={`${selectedUser ? `What ${selectedUser.name || selectedUser.username} did` : "What every user did"}, newest first · ${stats.actions_today ?? 0} actions today.`}
              actions={
                <>
                  {selectedUser && (
                    <button className="chip-btn active" onClick={() => setUserFilter(null)} title="Show every user">
                      {selectedUser.name || selectedUser.username} ✕
                    </button>
                  )}
                  {["all", ...MAIN_KINDS, "other"].map((k) => (
                    <button key={k} className={`chip-btn ${kindFilter === k ? "active" : ""}`} onClick={() => setKindFilter(k)}>
                      {k === "all" ? "All" : k === "other" ? "Other" : KINDS[k].label}
                    </button>
                  ))}
                </>
              }
            />
            {activity.length === 0 ? (
              <p className="muted">
                <SearchIcon width={14} height={14} /> No activity{kindFilter !== "all" || selectedUser ? " matches" : " yet"}.
              </p>
            ) : (
              <table style={{ tableLayout: "fixed", width: "100%" }}>
                <colgroup>
                  <col style={{ width: 130 }} />
                  <col style={{ width: 170 }} />
                  <col style={{ width: 120 }} />
                  <col />
                  <col style={{ width: 130 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th style={{ cursor: "default" }}>Time</th>
                    <th style={{ cursor: "default" }}>User</th>
                    <th style={{ cursor: "default", textAlign: "left" }}>Type</th>
                    <th style={{ cursor: "default", textAlign: "left" }}>Action</th>
                    <th style={{ cursor: "default" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {activity.map((a) => (
                    <tr key={a._key}>
                      <td title={new Date(a.created_at).toLocaleString()}>{fmtTime(a.created_at)}</td>
                      <td style={{ overflow: "hidden", textOverflow: "ellipsis" }} title={a.username}>{a.name || a.username}</td>
                      <td style={{ textAlign: "left" }}><KindTag kind={a.kind} /></td>
                      <td style={{ textAlign: "left", overflow: "hidden", textOverflow: "ellipsis" }} title={a.details}>
                        {a.action}
                        {a.details && <span className="muted"> · {a.details}</span>}
                      </td>
                      <td><StatusPill status={a.status} percent={a.percent} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
