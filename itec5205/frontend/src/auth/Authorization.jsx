import { useKeycloak } from "@react-keycloak/web";
import { Navigate } from "react-router-dom";
import { USE_KEYCLOAK } from "./keycloak";

// Realm roles of the Carleton realm. Installer is a superset of admin.
export const ROLES = { installer: "installer", admin: "admin", operator: "operator" };

// True if the Keycloak user is authenticated and has at least one of `roles`.
export const checkAuthorization = (keycloak, roles = []) =>
  Boolean(keycloak?.authenticated) && (roles.length === 0 || roles.some((role) => keycloak.hasRealmRole(role)));

// Without Keycloak everyone gets every role.
export const isInstallerUser = (keycloak) => !USE_KEYCLOAK || checkAuthorization(keycloak, [ROLES.installer]);
export const isAdminUser = (keycloak) => !USE_KEYCLOAK || checkAuthorization(keycloak, [ROLES.admin, ROLES.installer]);
export const isOperatorUser = (keycloak) => !USE_KEYCLOAK || checkAuthorization(keycloak, [ROLES.operator]);
export const isGuestUser = (keycloak) => !isAdminUser(keycloak) && !isOperatorUser(keycloak);

export function roleLabel(keycloak) {
  if (isInstallerUser(keycloak)) return "Installer";
  if (isAdminUser(keycloak)) return "Admin";
  if (isOperatorUser(keycloak)) return "Operator";
  return "Guest";
}

// useKeycloak() throws outside ReactKeycloakProvider (Keycloak disabled).
export function useAuth() {
  if (!USE_KEYCLOAK) return { keycloak: null, initialized: true };
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useKeycloak();
}

// Route guard: admins (and installers) only; others go home.
export function RequireAdminUser({ children }) {
  const { keycloak } = useAuth();
  return isAdminUser(keycloak) ? children : <Navigate to="/" replace />;
}
