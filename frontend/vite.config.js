import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

/** FastAPI gateway (uvicorn). Vite only serves the UI; you must run the API separately on this port. */
const defaultApi = "http://127.0.0.1:9000";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const target = env.VITE_API_PROXY ?? process.env.VITE_API_PROXY ?? defaultApi;

  return {
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      port: 3000,
      watch: { usePolling: true },
      proxy: {
        "/api": { target, changeOrigin: true },
        "/health": { target, changeOrigin: true },
        "/info": { target, changeOrigin: true },
        "/verify-api-key": { target, changeOrigin: true },
        "/generate/stream": { target, changeOrigin: true },
        "/generate": { target, changeOrigin: true },
      },
    },
  };
});
