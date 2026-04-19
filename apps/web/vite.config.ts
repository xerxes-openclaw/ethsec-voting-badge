/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./", // critical for static / thumb-drive mode
  server: {
    port: 5173,
    // Allow localtunnel hostnames so the dev server can be reached through the tunnel.
    allowedHosts: [".loca.lt", ".trycloudflare.com"],
    // Proxy API routes to the backend so callers only need ONE tunnel (the
    // web dev server). Keeps the staging URL stable even when Cloudflare
    // quick-tunnels flake.
    proxy: {
      "/config": "http://localhost:3001",
      "/submit": "http://localhost:3001",
      "/token-status": "http://localhost:3001",
      "/admin": "http://localhost:3001",
      "/health": "http://localhost:3001",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    globals: true,
  },
});
