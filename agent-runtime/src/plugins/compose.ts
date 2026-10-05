/**
 * SDD 15 §7.2：钩子组合器。
 *
 * pi-agent-core 对 `tool_call` / `tool_result` / `context` 的多个 handler 传同一个原始事件、
 * 取最后一个非空结果，不能表达拦截短路与补丁串联；钩子抛错还会让整个运行失败。
 * 因此每种钩子 Glaux 只向 harness 注册一个 handler，在这里按插件顺序组合。
 */
import { randomUUID } from "node:crypto";

import type {
  AgentHarness,
  AgentMessage,
  ToolCallEvent,
  ToolCallResult,
  ToolResultEvent,
  ToolResultPatch,
} from "@earendil-works/pi-agent-core";

import type { GlauxPlugin, RunContext } from "./types.js";

type HookLogger = (message: string, detail: { plugin: string; hook: string; trace_id: string; error: unknown }) => void;

const defaultLogger: HookLogger = (message, detail) => console.error(message, detail);

function report(logger: HookLogger, plugin: string, hook: string, error: unknown): string {
  const traceId = randomUUID();
  logger("plugin hook failed", { plugin, hook, trace_id: traceId, error });
  return traceId;
}

/** 顺序执行，第一个拦截即为结果；插件异常转为拦截。 */
export async function composeToolCall(
  plugins: GlauxPlugin[], event: ToolCallEvent, ctx: RunContext, logger: HookLogger = defaultLogger,
): Promise<ToolCallResult | undefined> {
  for (const plugin of plugins) {
    const hook = plugin.hooks?.tool_call;
    if (!hook) continue;
    try {
      const result = await hook(event, ctx);
      if (result?.block) return result;
    } catch (error) {
      report(logger, plugin.name, "tool_call", error);
      return { block: true, reason: "internal_error" };
    }
  }
  return undefined;
}

/** 顺序执行，每个插件看到上一个补丁后的结果；补丁按字段合并，`terminate` 一旦置位即保留。 */
export async function composeToolResult(
  plugins: GlauxPlugin[], event: ToolResultEvent, ctx: RunContext, logger: HookLogger = defaultLogger,
): Promise<ToolResultPatch | undefined> {
  let current = event;
  let merged: ToolResultPatch | undefined;
  for (const plugin of plugins) {
    const hook = plugin.hooks?.tool_result;
    if (!hook) continue;
    let patch: ToolResultPatch | undefined;
    try {
      patch = await hook(current, ctx);
    } catch (error) {
      report(logger, plugin.name, "tool_result", error);
      continue;
    }
    if (!patch) continue;
    const terminate = merged?.terminate || patch.terminate;
    merged = { ...merged, ...patch, ...(terminate ? { terminate } : {}) };
    current = {
      ...current,
      ...(patch.content !== undefined ? { content: patch.content } : {}),
      ...(patch.details !== undefined ? { details: patch.details } : {}),
      ...(patch.isError !== undefined ? { isError: patch.isError } : {}),
      ...(patch.usage !== undefined ? { usage: patch.usage } : {}),
    };
  }
  return merged;
}

/** 顺序执行，前一个插件的输出是后一个的输入；插件异常时沿用它的输入。 */
export async function composeContext(
  plugins: GlauxPlugin[], messages: AgentMessage[], ctx: RunContext, logger: HookLogger = defaultLogger,
): Promise<AgentMessage[]> {
  let current = messages;
  for (const plugin of plugins) {
    const hook = plugin.hooks?.context;
    if (!hook) continue;
    try {
      current = await hook(current, ctx);
    } catch (error) {
      report(logger, plugin.name, "context", error);
    }
  }
  return current;
}

/**
 * 每种钩子至多注册一个 handler；没有插件声明该钩子时不注册。返回注销函数。
 * `onBlock` 收到被拦截的工具调用标识，供展示区分「未执行」与「执行失败」（SDD 15 §5.1）。
 * `onContext` 收到 `context` 钩子组合前后的消息，供运行轨迹记录请求摘要（SDD 21 §7.1 规则 5）；
 * 传入时即使没有插件声明 `context` 也注册 handler。
 */
export function installHooks(
  harness: Pick<AgentHarness, "on">, plugins: GlauxPlugin[], ctx: RunContext, logger: HookLogger = defaultLogger,
  onBlock?: (toolCallId: string) => void,
  onContext?: (before: AgentMessage[], after: AgentMessage[]) => void,
): () => void {
  const disposers: (() => void)[] = [];
  const has = (name: "tool_call" | "tool_result" | "context") => plugins.some((plugin) => plugin.hooks?.[name]);
  if (has("tool_call")) {
    disposers.push(harness.on("tool_call", async (event) => {
      const result = await composeToolCall(plugins, event, ctx, logger);
      if (result?.block) onBlock?.(event.toolCallId);
      return result;
    }));
  }
  if (has("tool_result")) {
    disposers.push(harness.on("tool_result", (event) => composeToolResult(plugins, event, ctx, logger)));
  }
  if (has("context") || onContext) {
    disposers.push(harness.on("context", async (event) => {
      const messages = await composeContext(plugins, event.messages, ctx, logger);
      try {
        onContext?.(event.messages, messages);
      } catch (error) {
        // 轨迹采集失败不影响命令（SDD 21 §7.1 规则 6）
        report(logger, "trajectory", "context", error);
      }
      return { messages };
    }));
  }
  return () => disposers.forEach((dispose) => dispose());
}
