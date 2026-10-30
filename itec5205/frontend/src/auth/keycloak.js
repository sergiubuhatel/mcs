// Only one instance of Keycloak is created and reused.
// Keycloak is served under /auth on the same origin (nginx in Docker, the
// Vite proxy in dev), so the default URL works locally and via the tunnel.
import Keycloak from "keycloak-js";

const env = import.meta.env;

export const USE_KEYCLOAK = env.VITE_USE_KEYCLOAK !== "false";

const keycloak = new Keycloak({
  url: env.VITE_KEYCLOAK_URL || `${window.location.origin}/auth`,
  realm: env.VITE_KEYCLOAK_REALM || "Carleton",
  clientId: env.VITE_KEYCLOAK_CLIENT || "carleton_client",
});

export default keycloak;
