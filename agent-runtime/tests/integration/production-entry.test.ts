/** SDD 24 §7.1、§7.2、§15.1：单端口入口、Host / Origin / 会话令牌校验与 backend 内部令牌。 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { installBackendAuth } from "../../src/security/backend-auth.js";
import { isAllowedHost, isAllowedOrigin } from "../../src/security/local-access.js";
import { buildServer } from "../../src/transport/server.js";

const PORT = 7410;
const HOST = `127.0.0.1:${PORT}`;
const TOKEN = "s".repeat(64);
const BACKEND_TOKEN = "b".repeat(64);

let backend: Server;
let backendUrl: string;
const seen: { url: string; headers: IncomingHttpHeaders; bytes: number }[] = [];
let staticDir: string;

beforeAll(async () => {
  backend = createServer((request, response) => {
    let bytes = 0;
    request.on("data", (chunk: Buffer) => (bytes += chunk.length));
    request.on("end", () => {
      seen.push({ url: request.url ?? "", headers: request.headers, bytes });
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ ok: true, url: request.url }));
    });
  });
  await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
  backendUrl = `http://127.0.0.1:${(backend.address() as AddressInfo).port}`;

  staticDir = mkdtempSync(join(tmpdir(), "glaux-static-"));
  writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>Glaux</title>");
  mkdirSync(join(staticDir, "assets"));
  writeFileSync(join(staticDir, "assets", "app-abc.js"), "console.log(1)");
});

afterAll(async () => {
  await new Promise<void>((resolve) => backend.close(() => resolve()));
});

function app(sessionToken?: string) {
  return buildServer({
    localAccess: { port: PORT, sessionToken },
    frontend: { staticDir, backendUrl, backendToken: BACKEND_TOKEN },
  });
}

describe("host and origin rules", () => {
  it("accepts loopback names on the listening port only", () => {
    expect(isAllowedHost("127.0.0.1:7410", PORT)).toBe(true);
    expect(isAllowedHost("localhost:7410", PORT)).toBe(true);
    expect(isAllowedHost("[::1]:7410", PORT)).toBe(true);
    expect(isAllowedHost("127.0.0.1:8000", PORT)).toBe(false);
    expect(isAllowedHost("evil.example:7410", PORT)).toBe(false);
    expect(isAllowedHost(undefined, PORT)).toBe(false);
  });

  it("accepts missing or loopback origins", () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
    expect(isAllowedOrigin("http://localhost:5173")).toBe(true);
    expect(isAllowedOrigin("http://evil.example")).toBe(false);
    expect(isAllowedOrigin("null")).toBe(false);
  });
});

describe("production entry without session token", () => {
  it("rejects a rebound host with 421", async () => {
    const server = app();
    const response = await server.inject({ method: "GET", url: "/agent-api/v1/health", headers: { host: "evil.example:7410" } });
    expect(response.statusCode).toBe(421);
    await server.close();
  });

  it("rejects cross-site writes with 403", async () => {
    const server = app();
    const response = await server.inject({
      method: "POST",
      url: "/agent-api/v1/sessions",
      headers: { host: HOST, origin: "https://evil.example", "content-type": "application/json" },
      payload: "{}",
    });
    expect(response.statusCode).toBe(403);
    await server.close();
  });

  it("serves index.html for frontend routes and hashed assets with long cache", async () => {
    const server = app();
    const page = await server.inject({ method: "GET", url: "/some/route", headers: { host: HOST } });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("<title>Glaux</title>");
    const asset = await server.inject({ method: "GET", url: "/assets/app-abc.js", headers: { host: HOST } });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["cache-control"]).toContain("immutable");
    expect(asset.headers["x-frame-options"]).toBe("DENY");
    await server.close();
  });

  it("keeps unknown API routes as JSON 404", async () => {
    const server = app();
    const response = await server.inject({ method: "GET", url: "/agent-api/v1/nope", headers: { host: HOST } });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "not_found" } });
    await server.close();
  });

  it("proxies /api without the prefix and adds the internal token", async () => {
    const server = app();
    const response = await server.inject({ method: "GET", url: "/api/datasources?x=1", headers: { host: HOST } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, url: "/datasources?x=1" });
    expect(seen.at(-1)!.headers["x-glaux-internal"]).toBe(BACKEND_TOKEN);
    await server.close();
  });

  it("streams large uploads through the proxy beyond the JSON body limit", async () => {
    const server = app();
    const payload = Buffer.alloc(48 * 1024 * 1024, 1);
    const response = await server.inject({
      method: "POST",
      url: "/api/uploads",
      headers: { host: HOST, "content-type": "application/octet-stream" },
      payload,
    });
    expect(response.statusCode).toBe(200);
    expect(seen.at(-1)!.bytes).toBe(payload.length);
    await server.close();
  });
});

describe("production entry with session token", () => {
  it("returns 401 for API calls without the cookie and the hint page for navigation", async () => {
    const server = app(TOKEN);
    const api = await server.inject({ method: "GET", url: "/api/datasources", headers: { host: HOST } });
    expect(api.statusCode).toBe(401);
    const page = await server.inject({ method: "GET", url: "/", headers: { host: HOST } });
    expect(page.statusCode).toBe(401);
    expect(page.body).toContain("glaux open");
    const health = await server.inject({ method: "GET", url: "/agent-api/v1/health", headers: { host: HOST } });
    expect(health.statusCode).toBe(200);
    await server.close();
  });

  it("exchanges ?token for an HttpOnly cookie and strips it before proxying", async () => {
    const server = app(TOKEN);
    const login = await server.inject({ method: "GET", url: `/?token=${TOKEN}`, headers: { host: HOST } });
    expect(login.statusCode).toBe(303);
    expect(login.headers.location).toBe("/");
    const cookie = String(login.headers["set-cookie"]);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");

    const api = await server.inject({
      method: "GET",
      url: "/api/datasources",
      headers: { host: HOST, cookie: `theme=dark; glaux_session=${TOKEN}` },
    });
    expect(api.statusCode).toBe(200);
    expect(seen.at(-1)!.headers.cookie).toBe("theme=dark");
    await server.close();
  });

  it("accepts the token header for non-browser clients and rejects a wrong token", async () => {
    const server = app(TOKEN);
    const ok = await server.inject({ method: "GET", url: "/api/datasources", headers: { host: HOST, "x-glaux-token": TOKEN } });
    expect(ok.statusCode).toBe(200);
    expect(seen.at(-1)!.headers["x-glaux-token"]).toBeUndefined();
    const wrong = await server.inject({ method: "GET", url: `/?token=${"x".repeat(64)}`, headers: { host: HOST } });
    expect(wrong.statusCode).toBe(401);
    await server.close();
  });
});

describe("backend auth fetch wrapper", () => {
  it("adds the internal token only for backend-origin requests", async () => {
    const calls: { url: string; headers: Headers }[] = [];
    const target = {
      fetch: (input: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(input), headers: new Headers(init?.headers) });
        return Promise.resolve(new Response("ok"));
      },
    } as unknown as typeof globalThis;
    installBackendAuth("http://127.0.0.1:9000", BACKEND_TOKEN, target);
    await target.fetch("http://127.0.0.1:9000/objects/1", { headers: { accept: "application/json" } });
    await target.fetch("https://api.example.com/v1/chat");
    expect(calls[0]!.headers.get("x-glaux-internal")).toBe(BACKEND_TOKEN);
    expect(calls[0]!.headers.get("accept")).toBe("application/json");
    expect(calls[1]!.headers.get("x-glaux-internal")).toBeNull();
  });
});
