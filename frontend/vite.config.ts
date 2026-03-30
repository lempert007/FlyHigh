import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/tiffs": "http://localhost:8000",
      "/missions": {
        target: "http://localhost:8000",
        bypass(req) {
          // Browser page navigations send Accept: text/html — let Vite serve index.html
          // so React Router handles the route. API fetch calls don't include text/html.
          if (req.headers.accept?.includes("text/html")) return "/index.html";
        },
      },
      "/upload": "http://localhost:8000",
      "/plan": "http://localhost:8000",
      "/health": "http://localhost:8000",
      "/elevation-image": "http://localhost:8000",
      "/elevation-point": "http://localhost:8000",
      "/presets": "http://localhost:8000",
      "/settings": "http://localhost:8000",
      "/dashboard": "http://localhost:8000",
      "/tiles": "http://localhost:8000",
      "/system-config": "http://localhost:8000",
    },
  },
});
