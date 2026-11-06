// Settings -> Automatic Import: when the backend imports market data on its
// own (backend services/import_schedule.py), modeled on the listings app's
// Settings -> Data -> Automatic import.
import { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import { apiClient } from "../../api/client";
import { ClockIcon, PlayIcon, PlusIcon, SaveIcon, StopIcon } from "../../layout/icons";
import { stopImport } from "../dataImport/stopImport";
import { UNIVERSES } from "../dataImport/ImportControls";

const EVERY_HOURS = ["1", "2", "3", "4", "6", "8", "12", "24"];
const REFRESH_MS = 30000;
// Built-in default (backend services/import_schedule.py DEFAULT).
const DEFAULT_TIMES = ["04:00", "16:30", "18:00"];
const DEFAULT_UNIVERSE = "russell3000";
const clock = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
};

const when = (iso) =>
  iso
    ? new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : null;

function describe(schedule) {
  if (!schedule || schedule === "off") return "Off";
  if (schedule.startsWith("daily@")) {
    const list = schedule.slice(6).split(",").map(clock);
    const joined = list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : list[0];
    return `Every day at ${joined} (Ottawa time)`;
  }
  const n = Number(schedule.slice(6));
  return `Every ${n} hour${n === 1 ? "" : "s"}`;
}

function runSummary(run) {
  if (!run) return null;
  if (!run.total) return "Already up to date";
  const parts = [`${(run.succeeded ?? 0).toLocaleString()} / ${run.total.toLocaleString()} companies`];
  if (run.failed) parts.push(`${run.failed.toLocaleString()} failed`);
  if (run.records != null) parts.push(`${run.records.toLocaleString()} new prices`);
  return parts.join(" · ");
}

const STATUS_TEXT = { running: "Running", completed: "Completed", completed_with_failures: "Completed with failures", stopped: "Stopped", failed: "Failed" };

export default function ImportScheduleCard() {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState("daily");
  const [times, setTimes] = useState(DEFAULT_TIMES);
  const [hours, setHours] = useState("6");
  const [universe, setUniverse] = useState(DEFAULT_UNIVERSE);
  const [tradingDays, setTradingDays] = useState(true);
  const [busy, setBusy] = useState(null);

  const applyForm = (d) => {
    const s = d.schedule || "off";
    setMode(s.startsWith("daily@") ? "daily" : s.startsWith("every:") ? "every" : "off");
    if (s.startsWith("daily@")) setTimes(s.slice(6).split(","));
    if (s.startsWith("every:")) setHours(s.slice(6));
    setUniverse(d.universe || DEFAULT_UNIVERSE);
    setTradingDays(d.trading_days !== false);
  };

  const load = useCallback(async (resetForm = false) => {
    try {
      const { data } = await apiClient.get("/api/settings/import-schedule");
      setInfo(data);
      setError(null);
      if (resetForm) applyForm(data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  }, []);

  useEffect(() => {
    load(true);
    const id = setInterval(() => load(false), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const cleanTimes = [...new Set(times.filter(Boolean))].sort();
  const next = mode === "daily" ? `daily@${cleanTimes.join(",")}` : mode === "every" ? `every:${hours}` : "off";
  const isDefault = next === `daily@${DEFAULT_TIMES.join(",")}` && universe === DEFAULT_UNIVERSE && tradingDays;
  const useDefaults = () => {
    setMode("daily");
    setTimes(DEFAULT_TIMES);
    setUniverse(DEFAULT_UNIVERSE);
    setTradingDays(true);
  };
  const setTimeAt = (i, v) => setTimes((list) => list.map((t, j) => (j === i ? v : t)));
  const dirty = info && (next !== info.schedule || universe !== info.universe || tradingDays !== (info.trading_days !== false));

  const save = async () => {
    if (mode === "daily" && !cleanTimes.length) {
      toast.error("Add at least one time");
      return;
    }
    setBusy("save");
    try {
      const { data } = await apiClient.put("/api/settings/import-schedule", { schedule: next, universe, trading_days: tradingDays });
      setInfo(data);
      applyForm(data);
      toast.success(next === "off" ? "Automatic import turned off" : "Schedule saved");
    } catch (err) {
      toast.error(err.response?.data?.error || err.message);
    } finally {
      setBusy(null);
    }
  };

  const runNow = async () => {
    setBusy("run");
    try {
      const { data } = await apiClient.post("/api/settings/import-schedule/run");
      toast.success(data.message || "Import started");
      load(false);
    } catch (err) {
      toast.error(err.response?.data?.error || err.message);
    } finally {
      setBusy(null);
    }
  };

  const current = info?.last_import?.status === "running" ? info.last_import : null;
  const stopNow = async () => {
    if (!window.confirm("Stop the running import? The companies in progress finish first; the rest can be resumed on Market Data.")) return;
    setBusy("stop");
    await stopImport(current._key);
    setBusy(null);
    load(false);
  };

  const last = info?.last_auto;
  const tiles = [
    ["Next automatic import", info ? (info.next ? when(info.next) : "Off") : "…", info ? describe(info.schedule) : null],
    ["Last automatic import", last ? when(last.created_at) : "None yet", last ? `${STATUS_TEXT[last.status] || last.status} · ${runSummary(last)}` : null],
    ["Last import (any)", info?.last_import ? when(info.last_import.created_at) : "None yet",
      info?.last_import ? `${STATUS_TEXT[info.last_import.status] || info.last_import.status} · ${info.last_import.source || "manual"}` : null],
    ["Scheduler", info ? (info.scheduler?.alive ? "Running" : "Not running") : "…",
      info?.running ? `Waiting: ${info.running}` : info?.scheduler?.alive ? "Checks every 30 s" : "Starts with the backend"],
  ];

  const o = info?.options;
  const what = o
    ? [o.import_history && `price history since ${o.years} year${o.years === 1 ? "" : "s"} ago`, o.import_statistics && "statistics",
       o.import_calculated_stats && "calculated statistics", o.import_earnings && "financial results"].filter(Boolean).join(", ")
    : "";

  return (
    <section className="card settings-card import-schedule-card">
      <div className="card-header settings-card-header">
        <div className="icon-badge" style={{ background: "#06b6d422", color: "#06b6d4", width: 42, height: 42, borderRadius: 11 }}>
          <ClockIcon width={22} height={22} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 style={{ margin: 0 }}>Automatic Import</h3>
          <p className="muted" style={{ margin: 0 }}>The backend imports market data from Yahoo Finance on its own, on this schedule. How often and when the data is imported. Saved with its own button, separately from the defaults below.</p>
        </div>
        {current ? (
          <button className="btn danger" onClick={stopNow} disabled={busy != null || !!current.stop_requested_at}
            title="Stop the running import (the rest can be resumed on Market Data)">
            <StopIcon width={15} height={15} /> {current.stop_requested_at || busy === "stop" ? "Stopping…" : "Stop import"}
          </button>
        ) : (
          <button className="btn secondary" onClick={runNow} disabled={busy != null || !!info?.running} title={info?.running ? info.running : "Start this import now"}>
            <PlayIcon width={15} height={15} /> {busy === "run" ? "Starting…" : "Import now"}
          </button>
        )}
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}

      <div className="schedule-tiles">
        {tiles.map(([label, value, sub]) => (
          <div key={label} className="stat-tile schedule-tile">
            <div style={{ minWidth: 0 }}>
              <div className="stat-card-label">{label}</div>
              <div className={`schedule-tile-value ${label === "Scheduler" && info && !info.scheduler?.alive ? "warn-text" : ""}`}>{value}</div>
              {sub && <div className="muted schedule-tile-sub">{sub}</div>}
            </div>
          </div>
        ))}
      </div>

      <div className="schedule-form">
        <div className="seg" role="group" aria-label="Schedule">
          {[["off", "Off"], ["daily", "Daily"], ["every", "Every few hours"]].map(([k, l]) => (
            <button key={k} type="button" className={mode === k ? "active" : ""} onClick={() => setMode(k)}>{l}</button>
          ))}
        </div>
        {mode === "daily" && (
          <div className="schedule-field schedule-times">
            at
            {times.map((t, i) => (
              <span key={i} className="schedule-time">
                <input type="time" aria-label={`Time ${i + 1}`} value={t} onChange={(e) => setTimeAt(i, e.target.value)} />
                {times.length > 1 && (
                  <button type="button" className="schedule-time-remove" title="Remove this time" aria-label="Remove this time"
                    onClick={() => setTimes((list) => list.filter((_, j) => j !== i))}>×</button>
                )}
              </span>
            ))}
            {times.length < 12 && (
              <button type="button" className="btn secondary schedule-add" title="Add another daily import"
                onClick={() => setTimes((list) => [...list, "12:00"])}><PlusIcon width={14} height={14} /> Add time</button>
            )}
            Ottawa time
          </div>
        )}
        {mode === "every" && (
          <label className="schedule-field">every
            <select value={hours} onChange={(e) => setHours(e.target.value)}>{EVERY_HOURS.map((h) => <option key={h} value={h}>{h} h</option>)}</select>
          </label>
        )}
        {mode !== "off" && (
          <label className="schedule-field">companies
            <select value={universe} onChange={(e) => setUniverse(e.target.value)}>
              {Object.entries(UNIVERSES).map(([value, u]) => <option key={value} value={value}>{u.option}</option>)}
            </select>
          </label>
        )}
        {mode === "daily" && (
          <label className="toggle" htmlFor="schedule-trading-days" title="Skip the runs that would find no new close (a run before noon fetches the previous day's close)">
            <input id="schedule-trading-days" type="checkbox" checked={tradingDays} onChange={(e) => setTradingDays(e.target.checked)} />
            <span className="toggle-track"><span className="toggle-thumb" /></span>
            <span className="muted">Trading days only</span>
          </label>
        )}
        <button className="btn secondary" onClick={useDefaults} disabled={isDefault || busy != null}
          title="Russell 3000 every day at 4:00 AM, 4:30 PM and 6:00 PM, trading days only (Save to keep it)">
          Use defaults
        </button>
        <button className="btn" onClick={save} disabled={!dirty || busy != null} title={dirty ? "Save the schedule" : "No changes"}>
          <SaveIcon width={15} height={15} /> {busy === "save" ? "Saving…" : "Save schedule"}
        </button>
      </div>
      {o && (
        <p className="muted schedule-note">
          Imports {what || "nothing (turn an import option on in Data Defaults)"}; companies already imported:{" "}
          {o.existing === "reimport" ? "re-imported" : o.existing === "update" ? "caught up" : "skipped, or caught up when there is no new company"} (Data Defaults).
          It waits while another import is running and shows in the bottom bar and on the Dashboard as “Automatic import”.
        </p>
      )}
    </section>
  );
}
