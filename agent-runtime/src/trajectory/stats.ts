/**
 * SDD 21 §9.5：会话统计——输入区上下文面板的会话级合计。
 * 直接扫会话分支的审计条目（模型调用、工具耗时、请求头），不做轨迹投影，故不带正文。
 */
import type { SessionTreeEntry } from "@earendil-works/pi-agent-core";

import type { SessionStats } from "../contracts.js";
import { TOOL_TIMING_ENTRY } from "../pi/session-service.js";
import { MODEL_CALL_ENTRY, REQUEST_HEADER_ENTRY } from "./capture.js";

type Data = Record<string, unknown>;

function record(value: unknown): Data | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Data : undefined;
}

function num(source: Data | undefined, key: string): number {
  const value = source?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function sessionStats(entries: readonly SessionTreeEntry[]): SessionStats {
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  let modelCalls = 0;
  let toolCalls = 0;
  let modelMs = 0;
  let toolMs = 0;
  let firstTokenSum = 0;
  let firstTokenCount = 0;
  let messages = 0;
  let system = 0;
  let tools = 0;
  let window: number | null = null;

  const addUsage = (value: unknown) => {
    const source = record(value);
    usage.input += num(source, "input");
    usage.output += num(source, "output");
    usage.cacheRead += num(source, "cacheRead");
    usage.cacheWrite += num(source, "cacheWrite");
    usage.cost += num(record(source?.cost), "total");
  };

  for (const entry of entries) {
    if (entry.type === "message") {
      const message = record((entry as { message?: unknown }).message);
      if (message?.role === "assistant") {
        modelCalls += 1;
        addUsage(message.usage);
      } else if (message?.role === "toolResult") {
        toolCalls += 1;
      }
      continue;
    }
    // 压缩也是一次模型调用，代价计入合计（不参与耗时：它在命令内异步完成）。
    if (entry.type === "compaction") {
      modelCalls += 1;
      addUsage((entry as { usage?: unknown }).usage);
      continue;
    }
    if (entry.type !== "custom") continue;
    const data = record(entry.data) ?? {};
    if (entry.customType === MODEL_CALL_ENTRY) {
      modelMs += num(data, "duration_ms");
      if (typeof data.first_token_ms === "number") {
        firstTokenSum += data.first_token_ms;
        firstTokenCount += 1;
      }
      const est = record(record(data.request)?.est_tokens);
      if (typeof est?.messages === "number") messages = est.messages;
    } else if (entry.customType === TOOL_TIMING_ENTRY) {
      // 等待用户回复（审批、ask_user）的时长不算工具执行时间。
      toolMs += Math.max(0, num(data, "duration_ms") - num(data, "waited_ms"));
    } else if (entry.customType === REQUEST_HEADER_ENTRY) {
      if (typeof data.context_window === "number") window = data.context_window;
      const est = record(record(data.body)?.est_tokens);
      if (est) {
        system = num(est, "prompt");
        tools = num(est, "tools");
      }
    }
  }

  const generatedMs = Math.max(0, modelMs - firstTokenSum);
  const total = system + tools + messages;
  const inputTokens = usage.input + usage.cacheRead;
  return {
    model_calls: modelCalls,
    tool_calls: toolCalls,
    usage: { ...usage },
    model_ms: modelMs,
    tool_ms: toolMs,
    first_token_avg_ms: firstTokenCount ? Math.round(firstTokenSum / firstTokenCount) : null,
    output_tps: generatedMs > 0 ? usage.output / (generatedMs / 1000) : null,
    cache_hit_ratio: inputTokens > 0 ? usage.cacheRead / inputTokens : null,
    context: total > 0
      ? { tokens: total, window, system, tools, messages }
      : null,
  };
}
