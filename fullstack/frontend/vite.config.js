import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Proxy /api/* → FastAPI backend during local dev
      // so the browser never needs to handle CORS for Anthropic calls
      "/api": {
        target:       "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir:    "dist",
    sourcemap: false,
  },
});
