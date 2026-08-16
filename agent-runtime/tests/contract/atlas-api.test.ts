import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import type { ConnectionInput } from "../../src/contracts.js";
import type { ModelRuntime } from "../../src/pi/model-runtime.js";
import { buildServer } from "../../src/transport/server.js";

// `/agent-api/v1/atlas/describe` 契约：入参校验、api_key/credential 双写法、描述形状、
// 凭据在请求后被丢弃（disposeCredential）、模型失败 → 502 且 body 不带凭据。

function fakeRuntimeFactory(answer: string, seen: { connections: ConnectionInput[]; disposed: number }) {
  return (connection: ConnectionInput): ModelRuntime => {
    seen.connections.push(connection);
    const faux = fauxProvider({ models: [{ id: connection.model, input: ["text", "image"] }] });
    faux.setResponses([fauxAssistantMessage(answer)]);
    const models = createModels();
    models.setProvider(faux.provider);
    return {
      models,
      model: faux.getModel(),
      disposeCredential() {
        seen.disposed += 1;
      },
    };
  };
}

const GOOD = '{"modality":"TEM","subject":"GBM","findings":[{"name":"EDD"}],"pattern":"granular","summary":"s","extra":{"mag":"x8000"}}';

describe("POST /agent-api/v1/atlas/describe", () => {
  const servers: ReturnType<typeof buildServer>[] = [];
  afterEach(async () => {
    await Promise.all(servers.map((s) => s.close()));
    servers.length = 0;
  });

  function make(answer = GOOD) {
    const seen = { connections: [] as ConnectionInput[], disposed: 0 };
    const server = buildServer({ atlas: { runtimeFactory: fakeRuntimeFactory(answer, seen) } });
    servers.push(server);
    return { server, seen };
  }

  it("returns a normalized description and disposes the credential", async () => {
    const { server, seen } = make();
    const res = await server.inject({
      method: "POST",
      url: "/agent-api/v1/atlas/describe",
      payload: {
        image_base64: "iVBORw0KGgo=",
        hint: "标签：TEM",
        connection: { provider: "openai-compatible", model: "vlm", base_url: "http://127.0.0.1:1234/v1", api_key: "sk-secret", context_window: 8192, max_tokens: 1024 },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.statement_version).toBe("v1");
    expect(body.description).toEqual({
      modality: "TEM",
      subject: "GBM",
      findings: [{ name: "EDD" }],
      pattern: "granular",
      summary: "s",
      extra: { mag: "x8000" },
    });
    expect(seen.connections[0]).toMatchObject({ provider: "openai-compatible", model: "vlm", credential: "sk-secret", vision: true });
    expect(seen.disposed).toBe(1);
    expect(JSON.stringify(body)).not.toContain("sk-secret");
  });

  it("accepts `credential` as well as legacy provider ids", async () => {
    const { server, seen } = make();
    const res = await server.inject({
      method: "POST",
      url: "/agent-api/v1/atlas/describe",
      payload: { image_base64: "AAAA", connection: { provider: "openai_compatible", model: "m", credential: "c1", base_url: "http://x/v1" } },
    });
    expect(res.statusCode).toBe(200);
    expect(seen.connections[0]).toMatchObject({ provider: "openai-compatible", credential: "c1" });
  });

  it("400 on missing image / connection / unsupported provider", async () => {
    const { server } = make();
    for (const payload of [
      {},
      { image_base64: "AAAA" },
      { image_base64: "AAAA", connection: { provider: "nope", model: "m" } },
      { image_base64: "AAAA", connection: { provider: "anthropic" } },
      { connection: { provider: "anthropic", model: "m" } },
    ]) {
      const res = await server.inject({ method: "POST", url: "/agent-api/v1/atlas/describe", payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json().error.code).toBe("invalid_request");
    }
  });

  it("502 describe_failed when the model never returns JSON; credential absent from body and disposed", async () => {
    const { server, seen } = make("no json at all");
    const res = await server.inject({
      method: "POST",
      url: "/agent-api/v1/atlas/describe",
      payload: { image_base64: "AAAA", connection: { provider: "anthropic", model: "m", credential: "sk-zzz" } },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe("describe_failed");
    expect(res.body).not.toContain("sk-zzz");
    expect(seen.disposed).toBe(1);
  });
});
