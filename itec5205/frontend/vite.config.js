import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    // Keycloak (docker compose, host port 9090) on the same origin, as nginx does.
    proxy: { "/auth": "http://localhost:9090" },
  },
});
