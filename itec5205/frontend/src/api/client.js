import axios from "axios";
import keycloak, { USE_KEYCLOAK } from "../auth/keycloak";

// An explicit empty string (set at Docker build time) means "same origin,
// let nginx proxy /api and /socket.io" -- distinct from "unset" (local dev).
const API_URL = import.meta.env.VITE_API_URL !== undefined ? import.meta.env.VITE_API_URL : "http://localhost:5000";

export const apiClient = axios.create({
  baseURL: API_URL,
  headers: { "Content-Type": "application/json" },
});

export const API_URL_BASE = API_URL;

// The signed-in user's Keycloak token (refreshed when about to expire), so the
// backend knows who made each change (Dashboard) and can check roles.
export async function authHeaders() {
  if (!USE_KEYCLOAK || !keycloak.authenticated) return {};
  await keycloak.updateToken(30).catch(() => {});
  return { Authorization: `Bearer ${keycloak.token}` };
}

apiClient.interceptors.request.use(async (config) => {
  Object.assign(config.headers, await authHeaders());
  return config;
});
