import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// /api 代理到后端，前端用同源地址访问，免 CORS 配置
export default defineConfig({
  plugins: [react()],

  // 显式声明依赖，让 Vite 在 dev server 启动阶段就完成预构建。
  // 否则 Vite 8 会先 listen / 打印 ready，再在后台扫描并构建依赖（日志里的
  // "optimizer scanning dependencies"），此时浏览器若已打开，
  // 拿到的依赖模块尚未就绪，首屏就是空白，需要手动刷新一次。
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "class-variance-authority",
      "clsx",
      "tailwind-merge",
      "lucide-react",
      "react-markdown",
      "remark-gfm",
    ],
  },

  server: {
    port: 5173,
    // 预热入口与组件：启动时先把这些模块转换好，首访不必现等
    warmup: {
      clientFiles: ["./src/main.tsx", "./src/App.tsx", "./src/components/*.tsx"],
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
