import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// dev 期把 API 反代到 FastAPI（8000），前端只认同源 /api——生产同源部署零改动。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});
