/** SDD 21 §9.5：会话统计的聚合口径。 */
import type { SessionTreeEntry } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";

import { sessionStats } from "../../src/trajectory/stats.js";

let seq = 0;
const ts = (n: number) => new Date(Date.UTC(2026, 9, 24, 0, 0, n)).toISOString();
function entry(body: Record<string, unknown>): SessionTreeEntry {
  seq += 1;
  return { id: `s${seq}`, parentId: seq > 1 ? `s${seq - 1}` : null, timestamp: ts(seq), ...body } as SessionTreeEntry;
}
const custom = (customType: string, data: Record<string, unknown>) => entry({ type: "custom", customType, data });
const assistant = (usage: Record<string, unknown>) => entry({
  type: "message",
  message: { role: "assistant", content: [{ type: "text", text: "ok" }], stopReason: "stop", usage, timestamp: 0 },
});
const toolResult = () => entry({
  type: "message",
  message: { role: "toolResult", toolCallId: "t1", toolName: "bash", content: [], isError: false, timestamp: 0 },
});
const modelCall = (data: Record<string, unknown>) => custom("glaux.model.call", data);
const toolTiming = (data: Record<string, unknown>) => custom("glaux.tool.timing", data);
const header = (data: Record<string, unknown>) => custom("glaux.request.header", data);

describe("sessionStats", () => {
  it("汇总用量、费用、耗时与上下文分段", () => {
    const stats = sessionStats([
      header({
        context_window: 200_000,
        body: { prompt: "p", segments: [], tools: [], est_tokens: { prompt: 1_500, tools: 16_700 } },
      }),
      modelCall({
        step: 1,
        started_at: 0,
        first_token_ms: 400,
        duration_ms: 3_000,
        request: { message_count: 3, pruned_images: 0, injected: [], est_tokens: { messages: 2_500 } },
      }),
      assistant({ input: 1_000, output: 200, cacheRead: 9_000, cacheWrite: 0, cost: { total: 0.25 } }),
      toolTiming({ tool_call_id: "t1", duration_ms: 5_000, waited_ms: 2_000 }),
      toolResult(),
      modelCall({
        step: 2,
        started_at: 0,
        first_token_ms: 600,
        duration_ms: 2_000,
        request: { message_count: 5, pruned_images: 0, injected: [], est_tokens: { messages: 2_500 } },
      }),
      assistant({ input: 500, output: 100, cacheRead: 1_000, cacheWrite: 0, cost: { total: 0.05 } }),
    ]);

    expect(stats.model_calls).toBe(2);
    expect(stats.tool_calls).toBe(1);
    expect(stats.usage).toEqual({ input: 1_500, output: 300, cacheRead: 10_000, cacheWrite: 0, cost: 0.3 });
    // 模型用时含首 token 等待；工具用时扣掉等待用户的 2 秒。
    expect(stats.model_ms).toBe(5_000);
    expect(stats.tool_ms).toBe(3_000);
    expect(stats.first_token_avg_ms).toBe(500);
    // 300 tokens / (5000 - 1000) ms = 75 tok/s
    expect(stats.output_tps).toBeCloseTo(75);
    expect(stats.cache_hit_ratio).toBeCloseTo(10_000 / 11_500);
    expect(stats.context).toEqual({ tokens: 1_500 + 16_700 + 2_500, window: 200_000, system: 1_500, tools: 16_700, messages: 2_500 });
  });

  it("空会话没有上下文估算，也不算速度", () => {
    expect(sessionStats([])).toMatchObject({
      model_calls: 0,
      tool_calls: 0,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
      model_ms: 0,
      tool_ms: 0,
      first_token_avg_ms: null,
      output_tps: null,
      cache_hit_ratio: null,
      context: null,
    });
  });

  it("压缩按一次模型调用计用量，重复的请求头沿用上一次的分段", () => {
    const stats = sessionStats([
      header({ context_window: 32_000, body: { prompt: "p", segments: [], tools: [], est_tokens: { prompt: 100, tools: 200 } } }),
      // 同哈希的后续请求头省略 body（SDD 21 §7.1 规则 2）
      header({ context_window: 32_000 }),
      entry({ type: "compaction", summary: "s", tokensBefore: 900, usage: { input: 800, output: 50, cacheRead: 0, cacheWrite: 0 } }),
    ]);
    expect(stats.model_calls).toBe(1);
    expect(stats.usage.output).toBe(50);
    expect(stats.context).toMatchObject({ system: 100, tools: 200, window: 32_000 });
  });
});
