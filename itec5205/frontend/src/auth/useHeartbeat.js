import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { API_URL_BASE, apiClient } from "../api/client";
import keycloak, { USE_KEYCLOAK } from "./keycloak";

const HEARTBEAT_MS = 30000;

// Tells the backend this user is online and which page they are on
// (Dashboard: logged-in users). Sent on every page change and every 30 s;
// closing the tab sends a "leave" beacon so the user shows offline at once.
export default function useHeartbeat() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (!USE_KEYCLOAK) return undefined;
    // sendBeacon can't set headers: the token goes in the body.
    const leave = () => keycloak.token && navigator.sendBeacon(`${API_URL_BASE}/api/activity/leave`, JSON.stringify({ token: keycloak.token }));
    window.addEventListener("pagehide", leave);
    return () => window.removeEventListener("pagehide", leave);
  }, []);
  useEffect(() => {
    if (!USE_KEYCLOAK) return undefined;
    const beat = () => apiClient.post("/api/activity/heartbeat", { page: pathname }).catch(() => {});
    beat();
    // After a reload the old page's leave beacon can land after the first beat.
    const catchUp = setTimeout(beat, 3000);
    const id = setInterval(beat, HEARTBEAT_MS);
    return () => {
      clearTimeout(catchUp);
      clearInterval(id);
    };
  }, [pathname]);
}
