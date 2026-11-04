import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative base works on Render, inside the Capacitor APK, and on any host
  base: "./",

  plugins: [react()],

  server: {
    host: "0.0.0.0",
    // Forward API and socket calls to the backend during local dev
    proxy: {
      "/api": "http://localhost:5000",
      "/socket.io": {
        target: "http://localhost:5000",
        ws: true
      }
    }
  },

  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
