/**
 * 本机访问守卫（SDD 24 §7.2）。
 *
 * - Host：只接受回环名（`127.0.0.1`、`localhost`、`[::1]`）加监听端口，挡 DNS 重绑定，返回 421。
 * - Origin：存在时主机须为回环名，挡跨站请求；缺 Origin 的请求来自非浏览器客户端，放行。
 * - 会话令牌（仅生产模式，`GLAUX_SESSION_TOKEN`）：`/agent-api`、`/api` 要求 Cookie
 *   `glaux_session` 或请求头 `X-Glaux-Token` 与令牌一致；`GET /?token=<令牌>` 写 Cookie 后重定向到 `/`。
 *   无令牌的页面导航返回提示页，告诉用户运行 `glaux open`。
 */
import { timingSafeEqual } from "node:crypto";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export interface LocalAccessOptions {
  /** 监听端口；Host 头必须带这个端口。 */
  port: number;
  /** 生产模式的会话令牌；缺省时不校验令牌，只做 Host / Origin 校验。 */
  sessionToken?: string | undefined;
}

export const SESSION_COOKIE = "glaux_session";
export const TOKEN_HEADER = "x-glaux-token";

const LOOPBACK_NAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);
const HEALTH_PATH = "/agent-api/v1/health";

/** `host[:port]` → `[host, port]`；IPv6 字面量保留方括号。 */
function splitHost(value: string): [string, string] {
  const match = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/u.exec(value.trim().toLowerCase());
  return match ? [match[1]!, match[2] ?? ""] : ["", ""];
}

export function isAllowedHost(host: string | undefined, port: number): boolean {
  if (!host) return false;
  const [name, hostPort] = splitHost(host);
  return LOOPBACK_NAMES.has(name) && hostPort === String(port);
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:") && LOOPBACK_NAMES.has(url.hostname);
  } catch {
    return false;
  }
}

function sameSecret(candidate: string | undefined, secret: string): boolean {
  if (!candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

function isApiPath(path: string): boolean {
  return path.startsWith("/agent-api/") || path === "/agent-api" || path.startsWith("/api/") || path === "/api";
}

const OPEN_HINT_HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Glaux</title>
<style>body{font:16px/1.6 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#f7f7f5;color:#1f1f1f}
@media (prefers-color-scheme:dark){body{background:#161616;color:#e8e8e8}code{background:#2a2a2a!important}}
main{max-width:32rem;padding:1rem}code{background:#ececea;padding:.1em .4em;border-radius:4px}</style></head>
<body><main><h1>Glaux</h1>
<p>请在终端运行 <code>glaux open</code> 打开 Glaux。</p>
<p>Run <code>glaux open</code> in a terminal to open Glaux.</p></main></body></html>`;

export function registerLocalAccess(server: FastifyInstance, options: LocalAccessOptions): void {
  const { port, sessionToken } = options;

  server.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isAllowedHost(request.headers.host, port)) {
      return reply.code(421).type("text/plain").send("Misdirected Request");
    }
    if (!isAllowedOrigin(request.headers.origin)) {
      return reply.code(403).type("text/plain").send("Forbidden origin");
    }
    if (!sessionToken) return;

    const path = request.url.split("?")[0] ?? "/";
    if (path === HEALTH_PATH) return;

    const query = request.query as Record<string, unknown> | undefined;
    if (request.method === "GET" && path === "/" && typeof query?.token === "string") {
      if (!sameSecret(query.token, sessionToken)) return reply.code(401).type("text/html").send(OPEN_HINT_HTML);
      return reply
        .header("set-cookie", `${SESSION_COOKIE}=${sessionToken}; HttpOnly; SameSite=Strict; Path=/`)
        .redirect("/", 303);
    }

    const presented =
      cookieValue(request.headers.cookie, SESSION_COOKIE) ??
      (typeof request.headers[TOKEN_HEADER] === "string" ? (request.headers[TOKEN_HEADER] as string) : undefined);
    if (sameSecret(presented, sessionToken)) return;

    if (isApiPath(path)) {
      return reply.code(401).send({ error: { code: "unauthorized", message: "Run `glaux open` to open Glaux." } });
    }
    // 页面导航与静态资源：只拦 HTML 导航，脚本与样式本身不含数据。
    if (request.method === "GET" && (path === "/" || !path.includes("."))) {
      return reply.code(401).type("text/html").send(OPEN_HINT_HTML);
    }
  });
}
