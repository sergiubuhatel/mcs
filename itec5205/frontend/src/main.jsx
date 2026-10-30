import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { BrowserRouter } from "react-router-dom";
import { ReactKeycloakProvider } from "@react-keycloak/web";

import App from "./App";
import { store } from "./app/store";
import keycloak, { USE_KEYCLOAK } from "./auth/keycloak";
import "./index.css";

const app = (
  <Provider store={store}>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </Provider>
);

const root = ReactDOM.createRoot(document.getElementById("root"));

if (USE_KEYCLOAK) {
  // No StrictMode here: its double mount initializes the Keycloak instance
  // twice, which keycloak-js rejects.
  root.render(
    <ReactKeycloakProvider
      authClient={keycloak}
      initOptions={{
        onLoad: "login-required",
        pkceMethod: "S256",
        checkLoginIframe: false, // no iframe polling
      }}
      LoadingComponent={<div style={{ padding: 24 }}>Signing in…</div>}
      onEvent={(event, error) => {
        if (error) console.error("[Keycloak error]:", event, error);
        // Refresh silently; back to the login page if the session is gone.
        if (event === "onTokenExpired") keycloak.updateToken(30).catch(() => keycloak.login());
      }}
    >
      {app}
    </ReactKeycloakProvider>
  );
} else {
  root.render(<React.StrictMode>{app}</React.StrictMode>);
}
