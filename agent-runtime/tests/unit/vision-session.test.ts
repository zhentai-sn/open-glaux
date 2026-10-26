/**
 * 视觉调用（图谱描述 / 挑选 / 定位）也要带 `x-opencode-session`。
 *
 * 视觉调用不是对话，Pi 的流式调用拿不到会话标识；缺这个头时 OpenCode Go / Zen 端点直接返回
 * `400 MissingSessionID`（见 `pi/opencode-session.ts`）。这里锁定两条边界：
 * 调用方给的 `sessionId` 原样落到模型调用选项上，没给时不要凭空造一个共享会话。
 */
import { describe, expect, it } from "vitest";

import { completeJson, visionSessionId, type VisionRuntime } from "../../src/pi/vision.js";

function captureRuntime(reply: string): { rt: VisionRuntime; options: unknown[] } {
  const options: unknown[] = [];
  const rt = {
    model: { id: "vlm" },
    models: {
      complete: async (_model: unknown, _context: unknown, opts?: unknown) => {
        options.push(opts);
        return { content: [{ type: "text", text: reply }], stopReason: "stop" };
      },
    },
  } as unknown as VisionRuntime;
  return { rt, options };
}

describe("visionSessionId", () => {
  it("同一内容稳定、不同内容互不相同", () => {
    const first = visionSessionId("atlas-describe", "iVBORw0KGgo=");
    expect(visionSessionId("atlas-describe", "iVBORw0KGgo=")).toBe(first);
    expect(visionSessionId("atlas-describe", "iVBORw0KGg0=")).not.toBe(first);
    expect(first.startsWith("atlas-describe-")).toBe(true);
    // 作用域不同不共用路由
    expect(visionSessionId("atlas-select", "iVBORw0KGgo=")).not.toBe(first);
  });
});

describe("视觉调用的会话标识", () => {
  const content = [{ type: "text" as const, text: "describe this" }];

  it("调用方给了 sessionId 就传给模型调用", async () => {
    const { rt, options } = captureRuntime('{"a":1}');
    await completeJson(rt, "system", content, undefined, "describe_failed", "atlas-describe-abc");
    expect(options[0]).toMatchObject({ sessionId: "atlas-describe-abc" });
  });

  it("没有 sessionId 时不带该选项（不臆造共享会话）", async () => {
    const { rt, options } = captureRuntime('{"a":1}');
    await completeJson(rt, "system", content, undefined, "describe_failed");
    expect(options[0]).toBeUndefined();
  });

  it("有 signal 时仍保留 signal，与 sessionId 同时下发", async () => {
    const { rt, options } = captureRuntime('{"a":1}');
    const controller = new AbortController();
    await completeJson(rt, "system", content, controller.signal, "describe_failed", "atlas-describe-abc");
    expect(options[0]).toMatchObject({ signal: controller.signal, sessionId: "atlas-describe-abc" });
  });
});
