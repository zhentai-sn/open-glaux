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

// dev：把 `localhost` 的页面导航 307 到 `127.0.0.1`。Windows 把 localhost 先解析为 ::1，
// WSL mirrored 网络不转发 ::1，每次建连先等约 200 ms 再回退 IPv4，WSI 瓦片逐块叠加这段延迟。
// 页面落到 127.0.0.1 后，/api 等相对请求随之走 IPv4。只改导航，不改 fetch / HMR。
function loopbackIpv4(): Plugin {
  return {
    name: "glaux-loopback-ipv4",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /^localhost(:\d+)?$/i.exec(req.headers.host ?? "");
        const isNavigation = req.method === "GET" && req.headers["sec-fetch-mode"] === "navigate";
        if (!m || !isNavigation) return next();
        res.statusCode = 307;
        res.setHeader("Location", `http://127.0.0.1${m[1] ?? ""}${req.url ?? "/"}`);
        res.end();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), cspMeta(), loopbackIpv4()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        // dev 后端端口可用 GLAUX_BACKEND_PORT 覆盖（spike 工作树与主仓并存时避 8000 冲突）
        target: `http://localhost:${process.env.GLAUX_BACKEND_PORT ?? "8000"}`,
        changeOrigin: true,
        // 带上原始来源：后端 /fs、/projects 只接受回环来源（SDD 13 §7.1 规则 3），
        // `vite --host` 对局域网开放时，代理直连地址恒为回环，只能靠 X-Forwarded-For 识别
        xfwd: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
      "/agent-api": {
        target: "http://127.0.0.1:8010",
        changeOrigin: true,
      },
    },
  },
});
