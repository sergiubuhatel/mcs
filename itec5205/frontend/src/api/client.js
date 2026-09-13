import axios from "axios";

// An explicit empty string (set at Docker build time) means "same origin,
// let nginx proxy /api and /socket.io" -- distinct from "unset" (local dev).
const API_URL = import.meta.env.VITE_API_URL !== undefined ? import.meta.env.VITE_API_URL : "http://localhost:5000";

export const apiClient = axios.create({
  baseURL: API_URL,
  headers: { "Content-Type": "application/json" },
});

export const API_URL_BASE = API_URL;
