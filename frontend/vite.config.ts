import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiUrl = env.VITE_API_URL || "http://localhost:8000";

  const proxyTarget = { target: apiUrl, changeOrigin: true };

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/tiffs": proxyTarget,
        "/missions": {
          ...proxyTarget,
          bypass(req) {
            // Browser page navigations send Accept: text/html — let Vite serve index.html
            // so React Router handles the route. API fetch calls don't include text/html.
            if (req.headers.accept?.includes("text/html")) return "/index.html";
          },
        },
        "/upload": proxyTarget,
        "/plan": proxyTarget,
        "/health": proxyTarget,
        "/elevation-image": proxyTarget,
        "/elevation-point": proxyTarget,
        "/presets": proxyTarget,
        "/settings": proxyTarget,
        "/dashboard": proxyTarget,
        "/tiles": proxyTarget,
        "/system-config": proxyTarget,
        "/preview": proxyTarget,
      },
    },
  };
});
