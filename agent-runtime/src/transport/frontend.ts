/**
 * 生产运行模式的单端口入口（SDD 24 §7.1）：同一端口提供前端构建产物，并把 `/api/*` 去前缀后
 * 反代到 backend。开发态不注册，前端仍由 Vite 提供。
 */
import { existsSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";

import httpProxy from "@fastify/http-proxy";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

import { INTERNAL_HEADER } from "../security/backend-auth.js";
import { SESSION_COOKIE, TOKEN_HEADER } from "../security/local-access.js";

export interface FrontendOptions {
  /** 前端构建产物目录（含 `index.html`）。 */
  staticDir: string;
  /** backend 地址，如 `http://127.0.0.1:53817`。 */
  backendUrl: string;
  /** backend 内部令牌（`X-Glaux-Internal`）。 */
  backendToken?: string | undefined;
}


function withoutSessionCookie(cookie: string | undefined): string | undefined {
  if (!cookie) return undefined;
  const kept = cookie
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith(`${SESSION_COOKIE}=`));
  return kept.length ? kept.join("; ") : undefined;
}

/**
 * 注册反代与静态文件，返回 `index.html` 内容供前端路由回退使用。
 * 同步排队注册，插件在 `server.ready()` 时加载。
 */
/** 静态响应附带的安全头；meta 中的 CSP 不支持 frame-ancestors。 */
export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "frame-ancestors 'none'",
};

export function registerFrontend(server: FastifyInstance, options: FrontendOptions): Buffer {
  const indexPath = join(options.staticDir, "index.html");
  if (!existsSync(indexPath)) throw new Error(`GLAUX_SERVE_STATIC has no index.html: ${options.staticDir}`);

  void server.register(httpProxy, {
    upstream: options.backendUrl.replace(/\/+$/u, ""),
    prefix: "/api",
    rewritePrefix: "",
    logLevel: "warn",
    // 重模型任务（/task/run）可能运行数分钟，放宽 undici 默认的 5 分钟超时。
    undici: { headersTimeout: 30 * 60_000, bodyTimeout: 30 * 60_000 },
    replyOptions: {
      rewriteRequestHeaders: (_request, headers) => {
        // 会话令牌只用于浏览器到 runtime 这一跳，不转发给 backend。
        const { cookie, [TOKEN_HEADER]: _token, ...rest } = headers;
        const kept = withoutSessionCookie(typeof cookie === "string" ? cookie : undefined);
        return {
          ...rest,
          ...(kept ? { cookie: kept } : {}),
          ...(options.backendToken ? { [INTERNAL_HEADER]: options.backendToken } : {}),
        };
      },
    },
  });

  void server.register(fastifyStatic, {
    root: options.staticDir,
    wildcard: false,
    // 带哈希的构建产物长期缓存，index.html 每次校验，升级后立即生效。
    setHeaders(response, filePath: string) {
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.header(name, value);
      response.header(
        "Cache-Control",
        filePath.includes(`${sep}assets${sep}`) ? "public, max-age=31536000, immutable" : "no-cache",
      );
    },
  });
  return readFileSync(indexPath);
}

/** 前端路由的回退：非 API 的 GET 返回 `index.html`。 */
export function isFrontendFallback(method: string, url: string): boolean {
  const path = url.split("?")[0] ?? "/";
  return (
    (method === "GET" || method === "HEAD") &&
    !path.startsWith("/agent-api") &&
    !path.startsWith("/api/") &&
    path !== "/api"
  );
}
