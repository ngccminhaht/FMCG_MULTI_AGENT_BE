import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), "");
  const apiProxyTarget = environment.API_PROXY_TARGET || "http://127.0.0.1:8000";

  return {
    appType: "spa",
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target: apiProxyTarget,
          changeOrigin: true,
        },
        "/health": {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
