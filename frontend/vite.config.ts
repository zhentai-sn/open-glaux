import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// dev 期把 API 反代到 FastAPI（8000），前端只认同源 /api——生产同源部署零改动。
//
// 防御：VLM API key 明文存 localStorage + 历史代码 Rich.tsx 用 dangerouslySetInnerHTML 渲染
// 来自后端注册表的变量（capabilities.id / tasks[].label 等）——任一注入即读 key 外泄。
// 主修复在 Rich.tsx（HTML 转义），此处为第二道防线：用 meta CSP 收紧脚本来源。
// - 生产：script-src 'self'（无 unsafe-inline）—— 产物是外联 bundle，可收紧。
// - 开发：放行 unsafe-inline 给 Vite HMR 注入的客户端模块脚本；Vite 5 不原生支持 nonce。
function cspMeta(): Plugin {
  return {
    name: "glaux-csp-meta",
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        const isDev = !!ctx.server;
        const csp = isDev
          ? // dev：HMR 客户端需要 inline module；connect 放 ws: 给 HMR socket
            "default-src 'self'; " +
            "script-src 'self' 'unsafe-inline'; " +
            "style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data: blob:; " +
            "connect-src 'self' ws: wss: http://localhost:5173 ws://localhost:5173; " +
            "font-src 'self' data:; " +
            "object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
          : // prod：脚本是外联 bundle，无任何内联脚本
            "default-src 'self'; " +
            "script-src 'self'; " +
            "style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data: blob:; " +
            "connect-src 'self'; " +
            "font-src 'self' data:; " +
            "object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
        const tag = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
        return html.replace(/<title>/, `${tag}\n    <title>`);
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), cspMeta()],
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
