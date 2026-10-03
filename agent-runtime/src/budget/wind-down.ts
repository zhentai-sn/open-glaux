/**
 * SDD 15 §7.8 规则 3：收尾回合在请求体里禁止调用工具，模型只能作答。
 *
 * 仅靠拦截理由，部分模型会继续调用工具直到宽限用尽，用户拿不到任何回答。
 * 工具定义保留：Anthropic 要求历史含 `tool_use` 时请求必须带 `tools`；只把 `tool_choice` 设为不调用。
 */
import type { AgentHarness } from "@earendil-works/pi-agent-core";

import type { RunBudget } from "./run-budget.js";

export function forbidToolCalls(api: string, payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const body = payload as Record<string, unknown>;
  if (!Array.isArray(body.tools) || body.tools.length === 0) return payload;
  if (api === "anthropic-messages") return { ...body, tool_choice: { type: "none" } };
  if (api === "openai-completions") return { ...body, tool_choice: "none" };
  return payload;
}

/** 预算进入收尾后改写每次模型请求；返回注销函数。 */
export function installWindDown(harness: Pick<AgentHarness, "on">, budget: Pick<RunBudget, "exhausted">): () => void {
  return harness.on("before_provider_payload", (event) =>
    budget.exhausted ? { payload: forbidToolCalls(event.model.api, event.payload) } : undefined);
}
