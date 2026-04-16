/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./", // critical for static / thumb-drive mode
  server: {
    port: 5173,
    // Allow localtunnel hostnames so the dev server can be reached through the tunnel.
    allowedHosts: [".loca.lt"],
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    globals: true,
  },
});
