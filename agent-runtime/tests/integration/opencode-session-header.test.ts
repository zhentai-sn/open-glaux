/**
 * 接线验证：`createModelRuntime` 组出的 provider 在真正发请求时带上 `x-opencode-session`。
 * 不联网——替换全局 fetch，只断言请求头。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Context } from "@earendil-works/pi-ai";

import type { ConnectionInput } from "../../src/contracts.js";
import { createModelRuntime } from "../../src/pi/model-runtime.js";
import { describeImage, visionSessionId } from "../../src/pi/vision.js";

const OPENCODE_CONNECTION: ConnectionInput = {
  provider: "openai-compatible",
  model: "opencode-test-model",
  base_url: "https://opencode.ai/zen/v1",
  context_window: 128_000,
  max_tokens: 4096,
  credential: "sk-test",
};

const LOCAL_CONNECTION: ConnectionInput = {
  ...OPENCODE_CONNECTION,
  base_url: "http://127.0.0.1:1234/v1",
};

/** 提供商直接选 OpenCode 且不填地址：应落到 Zen 缺省端点。 */
const OPENCODE_PROVIDER_CONNECTION: ConnectionInput = {
  provider: "opencode",
  model: "deepseek-v4-flash",
  context_window: 128_000,
  max_tokens: 4096,
  credential: "sk-test",
};

const CONTEXT: Context = {
  messages: [{ role: "user", content: "hello", timestamp: 1 }],
};

interface Captured {
  url: string;
  headers: Record<string, string>;
}

function captureFetch(): Captured[] {
  const calls: Captured[] = [];
  vi.stubGlobal("fetch", async (input: unknown, init?: { headers?: unknown }) => {
    const url = typeof input === "string" ? input : String((input as { url?: string }).url ?? "");
    const raw = init?.headers ?? {};
    const headers: Record<string, string> = {};
    if (raw instanceof Headers) {
      raw.forEach((value, key) => { headers[key.toLowerCase()] = value; });
    } else if (Array.isArray(raw)) {
      for (const [key, value] of raw as [string, string][]) headers[key.toLowerCase()] = value;
    } else {
      for (const [key, value] of Object.entries(raw as Record<string, string>)) {
        headers[key.toLowerCase()] = value;
      }
    }
    calls.push({ url, headers });
    return new Response("{}", { status: 400, headers: { "content-type": "application/json" } });
  });
  return calls;
}

async function waitForCalls(calls: Captured[]): Promise<Captured> {
  for (let i = 0; i < 100 && calls.length === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const first = calls[0];
  if (!first) throw new Error("没有捕获到请求");
  return first;
}

function streamOnce(connection: ConnectionInput, sessionId: string | undefined): Captured[] {
  const calls = captureFetch();
  const runtime = createModelRuntime(connection);
  // 走 Models 门面（AgentHarness 的实际调用面），确认补头发生在真实请求路径上。
  runtime.models.stream(runtime.model, CONTEXT, {
    apiKey: "sk-test",
    maxRetries: 0,
    ...(sessionId ? { sessionId } : {}),
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("OpenCode 会话头接线", () => {
  it("opencode.ai 端点带会话标识", async () => {
    const call = await waitForCalls(streamOnce(OPENCODE_CONNECTION, "conversation-1"));
    expect(call.url.startsWith("https://opencode.ai/zen/v1")).toBe(true);
    expect(call.headers["x-opencode-session"]).toBe("conversation-1");
  });

  it("换会话换标识，不共用路由", async () => {
    const call = await waitForCalls(streamOnce(OPENCODE_CONNECTION, "conversation-2"));
    expect(call.headers["x-opencode-session"]).toBe("conversation-2");
  });

  it("非 opencode.ai 端点不发该头", async () => {
    const call = await waitForCalls(streamOnce(LOCAL_CONNECTION, "conversation-1"));
    expect(call.headers["x-opencode-session"]).toBeUndefined();
  });

  it("没有会话标识时不发该头", async () => {
    const call = await waitForCalls(streamOnce(OPENCODE_CONNECTION, undefined));
    expect(call.headers["x-opencode-session"]).toBeUndefined();
  });

  it("provider=opencode 且不填地址：走 Zen 缺省端点并带会话标识", async () => {
    const call = await waitForCalls(streamOnce(OPENCODE_PROVIDER_CONNECTION, "conversation-3"));
    expect(call.url.startsWith("https://opencode.ai/zen/v1/")).toBe(true);
    expect(call.headers["x-opencode-session"]).toBe("conversation-3");
  });

  it("provider=opencode 时自定义地址（Go 订阅）优先于缺省端点", async () => {
    const call = await waitForCalls(
      streamOnce({ ...OPENCODE_PROVIDER_CONNECTION, base_url: "https://opencode.ai/zen/go/v1" }, "conversation-4"),
    );
    expect(call.url.startsWith("https://opencode.ai/zen/go/v1/")).toBe(true);
    expect(call.headers["x-opencode-session"]).toBe("conversation-4");
  });

  it("图谱描述这类视觉调用也带会话标识（否则 400 MissingSessionID）", async () => {
    const calls = captureFetch();
    const runtime = createModelRuntime({
      ...OPENCODE_PROVIDER_CONNECTION,
      base_url: "https://opencode.ai/zen/go/v1",
      vision: true,
    });
    const image = { data: "iVBORw0KGgo=", mimeType: "image/png" };
    const sessionId = visionSessionId("atlas-describe", image.data);
    // fetch 被替换成固定 400，这里只断言请求头；调用本身必然失败。
    await describeImage(runtime, { image, sessionId }).catch(() => undefined);
    const call = await waitForCalls(calls);
    expect(call.url.startsWith("https://opencode.ai/zen/go/v1/")).toBe(true);
    expect(call.headers["x-opencode-session"]).toBe(sessionId);
  });
});
