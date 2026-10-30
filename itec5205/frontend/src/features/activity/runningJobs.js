// Jobs running right now across all users (import, forecasts, RL, workflows),
// with who started them and their progress: GET /api/activity/running,
// refetched on every `dashboard_changed` push (Socket.IO room "dashboard",
// joined once for the whole app) plus a slow fallback poll.
// Used by the bottom bar (progress) and by start buttons, which are locked
// while another user's import / forecast runs (the backend refuses it too).
import { useSyncExternalStore } from "react";
import { apiClient } from "../../api/client";
import { getSocket, joinRoom } from "../../api/socket";
import keycloak, { USE_KEYCLOAK } from "../../auth/keycloak";

const ROOM = "dashboard";
const POLL_MS = 15000;

let jobs = [];
const listeners = new Set();
let started = false;

function load() {
  apiClient
    .get("/api/activity/running")
    .then((r) => {
      jobs = r.data.jobs || [];
      listeners.forEach((l) => l());
    })
    .catch(() => {}); // keep the last list; the next push or poll retries
}

function start() {
  if (started) return;
  started = true;
  let timer = null;
  const socket = getSocket();
  const join = () => joinRoom(ROOM); // again after every reconnect
  socket.on("connect", join);
  if (socket.connected) join();
  socket.on("dashboard_changed", () => {
    clearTimeout(timer);
    timer = setTimeout(load, 300); // a burst of progress pings -> one fetch
  });
  load();
  setInterval(load, POLL_MS);
}

function subscribe(listener) {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Every running/queued job: [{kind, action, details, user_id, name, status, percent, ...}]. */
export function useRunningJobs() {
  return useSyncExternalStore(subscribe, () => jobs);
}

export const VERBS = { import: "importing data", forecast: "running forecasts", rl: "building an RL portfolio", workflow: "running a workflow" };

/** The first job of `kind` started by another user, or null. */
export function useBusyByOthers(kind) {
  const all = useRunningJobs();
  const me = USE_KEYCLOAK ? keycloak.tokenParsed?.sub : null;
  return all.find((j) => j.kind === kind && j.user_id !== me) || null;
}

/** Text explaining why a start button is locked. */
export const busyText = (job) =>
  `Locked: ${job.name || job.username} is ${VERBS[job.kind] || "running a job"} (progress in the bottom bar).`;
