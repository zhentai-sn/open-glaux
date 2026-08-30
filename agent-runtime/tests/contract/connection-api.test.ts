import { afterEach, describe, expect, it } from "vitest";

import {
  anthropicVision,
  createConnectionProbe,
  nameVision,
} from "../../src/pi/connection-probe.js";
import { buildServer } from "../../src/transport/server.js";

// 迁自 backend/tests/test_vlm_probe_api.py + test_vlm_providers.py：探测端点契约、SSRF 短路、
// 视觉判定三条路径（anthropic 目录 / Ollama capabilities / 名称启发式）。全程假 fetch，不触网。

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type FetchLike = typeof globalThis.fetch;

function fakeFetch(routes: Record<string, Route>, calls: string[] = []) {
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(`${init?.method ?? "GET"} ${url}`);
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    if (!key) return new Response("not found", { status: 404 });
    return routes[key]!(url, init);
  }) as unknown as FetchLike;
  return { fetch: f, calls };
}

const loopback = async () => ["127.0.0.1"];
const publicIp = async () => ["160.79.104.10"];
const env = {} as NodeJS.ProcessEnv;

describe("connection probe · openai-compatible", () => {
  it("test: reports ready + model_count on 200", async () => {
    const { fetch, calls } = fakeFetch({
      "http://localhost:11434/v1/models": () => json({ data: [{ id: "a" }, { id: "b" }] }),
    });
    const probe = createConnectionProbe({ fetch, resolveHost: loopback, env });
    const r = await probe.test({ provider: "openai-compatible", base_url: "http://localhost:11434/v1" });
    expect(r).toEqual({ ok: true, http_status: 200, reason: "ready", model_count: 2 });
    expect(calls).toEqual(["GET http://localhost:11434/v1/models"]);
  });

  it("test: maps 401/404/ECONNREFUSED to explicit reasons", async () => {
    const p401 = createConnectionProbe({
      fetch: fakeFetch({ "http://localhost:1234/v1/models": () => json({}, 401) }).fetch,
      resolveHost: loopback,
      env,
    });
    expect(await p401.test({ provider: "openai-compatible", base_url: "http://localhost:1234/v1" }))
      .toMatchObject({ ok: false, http_status: 401, reason: expect.stringContaining("鉴权") });

    const p404 = createConnectionProbe({
      fetch: fakeFetch({ "http://localhost:1234/models": () => json({}, 404) }).fetch,
      resolveHost: loopback,
      env,
    });
    expect(await p404.test({ provider: "openai-compatible", base_url: "http://localhost:1234" }))
      .toMatchObject({ ok: false, http_status: 404, reason: expect.stringContaining("/v1") });

    const refused = createConnectionProbe({
      fetch: (async () => {
        throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
      }) as unknown as typeof fetch,
      resolveHost: loopback,
      env,
    });
    expect(await refused.test({ provider: "openai-compatible", base_url: "http://localhost:9/v1" }))
      .toMatchObject({ ok: false, http_status: null, reason: expect.stringContaining("连接被拒") });
  });

  it("listModels: Ollama capabilities decide vision, name heuristic as fallback", async () => {
    const root = "http://localhost:11434";
    const { fetch } = fakeFetch({
      [`${root}/v1/models`]: () =>
        json({ data: [{ id: "llama3:8b" }, { id: "qwen2.5-vl:7b" }, { id: "mystery:1b" }] }),
      [`${root}/api/version`]: () => json({ version: "0.6.0" }),
      [`${root}/api/show`]: async (_url, init) => {
        const { model } = JSON.parse(String(init?.body)) as { model: string };
        if (model === "llama3:8b") return json({ capabilities: ["completion"] }); // → no
        if (model === "qwen2.5-vl:7b") return json({ capabilities: ["completion", "vision"] });
        return json({}); // 无 capabilities → unknown → 名称兜底
      },
    });
    const probe = createConnectionProbe({ fetch, resolveHost: loopback, env });
    const r = await probe.listModels({ provider: "openai-compatible", base_url: `${root}/v1` });
    expect(r.models).toEqual([
      { id: "llama3:8b", vision: "no" },
      { id: "qwen2.5-vl:7b", vision: "yes" },
      { id: "mystery:1b", vision: "unknown" },
    ]);
  });

  it("listModels: non-Ollama gateway uses name heuristic only (never says no)", async () => {
    const { fetch } = fakeFetch({
      "http://localhost:1234/v1/models": () =>
        json({ data: [{ id: "gpt-4o-mini" }, { id: "llava-1.6" }, { id: "plain-llm" }] }),
      // 无 /api/version → 非 Ollama
    });
    const probe = createConnectionProbe({ fetch, resolveHost: loopback, env });
    const r = await probe.listModels({ provider: "openai-compatible", base_url: "http://localhost:1234/v1" });
    expect(r.models).toEqual([
      { id: "gpt-4o-mini", vision: "yes" },
      { id: "llava-1.6", vision: "yes" },
      { id: "plain-llm", vision: "unknown" },
    ]);
  });

  it("listModels: picks up context metadata from /models entries (varied field names)", async () => {
    const { fetch } = fakeFetch({
      "http://localhost:1234/v1/models": () =>
        json({
          data: [
            { id: "openrouter-ish", context_length: 200_000, top_provider: { max_completion_tokens: 16_384 } },
            { id: "lmstudio-ish", max_context_length: 8192, max_output_tokens: "2048" },
            { id: "bare-gateway" }, // 无元数据 → 不带字段，前端落默认值
          ],
        }),
    });
    const probe = createConnectionProbe({ fetch, resolveHost: loopback, env });
    const r = await probe.listModels({ provider: "openai-compatible", base_url: "http://localhost:1234/v1" });
    expect(r.models).toEqual([
      { id: "openrouter-ish", vision: "unknown", context_window: 200_000, max_tokens: 16_384 },
      { id: "lmstudio-ish", vision: "unknown", context_window: 8192, max_tokens: 2048 },
      { id: "bare-gateway", vision: "unknown" },
    ]);
  });

  it("listModels: Ollama context_length comes from /api/show model_info", async () => {
    const root = "http://localhost:11434";
    const { fetch } = fakeFetch({
      [`${root}/v1/models`]: () => json({ data: [{ id: "llama3:8b" }] }),
      [`${root}/api/version`]: () => json({ version: "0.6.0" }),
      [`${root}/api/show`]: () =>
        json({
          capabilities: ["completion", "vision"],
          model_info: { "general.architecture": "llama", "llama.context_length": 131_072 },
        }),
    });
    const probe = createConnectionProbe({ fetch, resolveHost: loopback, env });
    const r = await probe.listModels({ provider: "openai-compatible", base_url: `${root}/v1` });
    expect(r.models).toEqual([
      { id: "llama3:8b", vision: "yes", context_window: 131_072 },
    ]);
  });

  it("listModels: fetch failure returns empty list + reason (no throw)", async () => {
    const probe = createConnectionProbe({
      fetch: (async () => {
        throw new Error("connection reset");
      }) as unknown as typeof fetch,
      resolveHost: loopback,
      env,
    });
    const r = await probe.listModels({ provider: "openai-compatible", base_url: "http://localhost:1234/v1" });
    expect(r.models).toEqual([]);
    expect(r.reason).toContain("connection reset");
  });
});

describe("connection probe · anthropic", () => {
  it("lists models with pagination and annotates vision from catalog / family", async () => {
    const { fetch, calls } = fakeFetch({
      "https://api.anthropic.com/v1/models?limit=100&after_id=": () =>
        json({ data: [{ id: "claude-2.1" }], has_more: false }),
      "https://api.anthropic.com/v1/models?limit=100": () =>
        json({ data: [{ id: "claude-sonnet-4-5" }], has_more: true, last_id: "claude-sonnet-4-5" }),
    });
    const probe = createConnectionProbe({ fetch, resolveHost: publicIp, env });
    const r = await probe.listModels({ provider: "anthropic", credential: "sk-test" });
    expect(r.models).toEqual([
      { id: "claude-sonnet-4-5", vision: "yes" },
      { id: "claude-2.1", vision: "no" },
    ]);
    expect(calls).toHaveLength(2);
  });

  it("uses base_url override and falls back to ANTHROPIC_API_KEY env", async () => {
    let seenKey: string | null | undefined;
    const { fetch } = fakeFetch({
      "https://gw.example.com/v1/models": (_u, init) => {
        seenKey = new Headers(init?.headers).get("x-api-key");
        return json({ data: [{ id: "claude-x" }], has_more: false });
      },
    });
    const probe = createConnectionProbe({
      fetch,
      resolveHost: publicIp,
      env: { ANTHROPIC_API_KEY: "env-key" } as NodeJS.ProcessEnv,
    });
    const r = await probe.test({ provider: "anthropic", base_url: "https://gw.example.com" });
    expect(r).toMatchObject({ ok: true, model_count: 1 });
    expect(seenKey).toBe("env-key");
  });

  it("vision helpers follow the Python rules", () => {
    expect(anthropicVision("claude-instant-1.2")).toBe("no");
    expect(anthropicVision("claude-3-5-haiku-latest")).toBe("yes");
    expect(anthropicVision("something-else")).toBe("unknown");
    expect(nameVision("qwen2-vl-7b")).toBe("yes");
    // id 里没有 vl/vision 记号的原生多模态模型——漏判会让所有视觉工具静默消失
    expect(nameVision("MiniMaxAI/MiniMax-M3")).toBe("yes");
    expect(nameVision("mistral-7b")).toBe("unknown");
  });
});

describe("POST /agent-api/v1/connection/*", () => {
  const servers: ReturnType<typeof buildServer>[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.close()));
  });

  function serverWith(fetchImpl: FetchLike, resolveHost = loopback) {
    const server = buildServer({
      probe: createConnectionProbe({ fetch: fetchImpl, resolveHost, env }),
    });
    servers.push(server);
    return server;
  }

  it("test: happy path and legacy provider spelling", async () => {
    const server = serverWith(
      fakeFetch({ "http://localhost:11434/v1/models": () => json({ data: [{ id: "a" }] }) }).fetch,
    );
    const r = await server.inject({
      method: "POST",
      url: "/agent-api/v1/connection/test",
      payload: { provider: "openai_compatible", base_url: "http://localhost:11434/v1" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true, http_status: 200, reason: "ready", model_count: 1 });
  });

  it("test: openai-compatible without base_url → 400 invalid_request", async () => {
    const server = serverWith(fakeFetch({}).fetch);
    const r = await server.inject({
      method: "POST",
      url: "/agent-api/v1/connection/test",
      payload: { provider: "openai-compatible" },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe("invalid_request");
  });

  it("test: SSRF guard short-circuits before any network call", async () => {
    const { fetch, calls } = fakeFetch({});
    const server = serverWith(fetch, async () => ["10.0.0.9"]);
    const r = await server.inject({
      method: "POST",
      url: "/agent-api/v1/connection/test",
      payload: { provider: "openai-compatible", base_url: "https://10.0.0.9/v1" },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe("egress_blocked");
    expect(calls).toEqual([]);
  });

  it("models: returns annotated list", async () => {
    const server = serverWith(
      fakeFetch({
        "http://localhost:1234/v1/models": () => json({ data: [{ id: "llava:13b" }, { id: "qwen2.5:7b" }] }),
      }).fetch,
    );
    const r = await server.inject({
      method: "POST",
      url: "/agent-api/v1/connection/models",
      payload: { provider: "openai-compatible", base_url: "http://localhost:1234/v1" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().models).toEqual([
      { id: "llava:13b", vision: "yes" },
      { id: "qwen2.5:7b", vision: "unknown" },
    ]);
  });

  it("rejects unsupported provider and non-object bodies", async () => {
    const server = serverWith(fakeFetch({}).fetch);
    const bad = await server.inject({
      method: "POST",
      url: "/agent-api/v1/connection/models",
      payload: { provider: "gemini" },
    });
    expect(bad.statusCode).toBe(400);
    const arr = await server.inject({
      method: "POST",
      url: "/agent-api/v1/connection/test",
      payload: [],
    });
    expect(arr.statusCode).toBe(400);
  });

  it("does not leak the credential into error payloads", async () => {
    const server = serverWith(fakeFetch({}).fetch, async () => ["10.0.0.9"]);
    const r = await server.inject({
      method: "POST",
      url: "/agent-api/v1/connection/test",
      payload: { provider: "openai-compatible", base_url: "https://10.0.0.9/v1", credential: "sk-super-secret" },
    });
    expect(r.body).not.toContain("sk-super-secret");
  });
});
