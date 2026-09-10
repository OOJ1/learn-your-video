import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// /api 代理到后端，前端用同源地址访问，免 CORS 配置
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
