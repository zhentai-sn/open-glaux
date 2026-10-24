/**
 * 接线验证：连接上的推理档位落到 pi 的 thinking 参数（`body.reasoning_effort`）。
 * 不联网——替换全局 fetch，只看请求体。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Context } from "@earendil-works/pi-ai";

import type { ConnectionInput } from "../../src/contracts.js";
import { harnessThinkingLevel } from "../../src/pi/harness-registry.js";
import { createModelRuntime, validateConnectionInput } from "../../src/pi/model-runtime.js";

const BASE: ConnectionInput = {
  provider: "opencode",
  model: "deepseek-v4-flash",
  context_window: 200_000,
  max_tokens: 8192,
  credential: "sk-test",
};

const CONTEXT: Context = { messages: [{ role: "user", content: "hi", timestamp: 1 }] };

interface Captured { body: Record<string, unknown> }

function captureFetch(): Captured[] {
  const calls: Captured[] = [];
  vi.stubGlobal("fetch", async (_input: unknown, init?: { body?: unknown }) => {
    const raw = typeof init?.body === "string" ? init.body : "{}";
    calls.push({ body: JSON.parse(raw) as Record<string, unknown> });
    return new Response("{}", { status: 400, headers: { "content-type": "application/json" } });
  });
  return calls;
}

/** pi 的 `reasoning` 选项不含 `off`：关闭档位对应「不传」。 */
async function bodyFor(connection: ConnectionInput, level: "high" | undefined): Promise<Record<string, unknown>> {
  const calls = captureFetch();
  const runtime = createModelRuntime(connection);
  runtime.models.streamSimple(runtime.model, CONTEXT, {
    apiKey: "sk-test",
    maxRetries: 0,
    ...(level ? { reasoning: level } : {}),
  });
  for (let i = 0; i < 100 && calls.length === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  const first = calls[0];
  if (!first) throw new Error("没有捕获到请求");
  return first.body;
}

afterEach(() => vi.unstubAllGlobals());

describe("推理档位", () => {
  it("选了档位才声明 reasoning，并下发 reasoning_effort", async () => {
    const body = await bodyFor({ ...BASE, thinking_level: "high" }, "high");
    expect(body.reasoning_effort).toBe("high");
  });

  it("没选档位不给未知端点发它不认识的字段", async () => {
    const body = await bodyFor(BASE, "high");
    expect(body).not.toHaveProperty("reasoning_effort");
  });

  it("关闭档位不发参数", async () => {
    const body = await bodyFor({ ...BASE, thinking_level: "off" }, undefined);
    expect(body).not.toHaveProperty("reasoning_effort");
  });

  it("连接档位映射到 AgentHarness 的 thinkingLevel", () => {
    expect(harnessThinkingLevel(BASE)).toBe("off");
    expect(harnessThinkingLevel({ ...BASE, thinking_level: "medium" })).toBe("medium");
    // 越界值在校验层已拒，映射层按关闭兜底
    expect(harnessThinkingLevel({ ...BASE, thinking_level: "extreme" as never })).toBe("off");
  });

  it("拒绝未知档位", () => {
    expect(() => validateConnectionInput({ ...BASE, thinking_level: "extreme" as never })).toThrow(/thinking level/u);
    expect(() => validateConnectionInput({ ...BASE, thinking_level: "medium" })).not.toThrow();
  });
});
