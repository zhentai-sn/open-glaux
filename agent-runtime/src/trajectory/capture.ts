/**
 * SDD 21 §7.1：运行轨迹的采集——每条命令的请求头与每次模型调用的计时、请求摘要。
 * 两种条目都经命令的审计队列在命令结束时写入会话（与 `glaux.tool.timing` 同一路径）。
 */
import { createHash } from "node:crypto";

import { estimateTokens, type AgentHarnessEvent, type AgentMessage } from "@earendil-works/pi-agent-core";

import type { ModelCallEntry, RequestHeaderBody, RequestHeaderEntry } from "../contracts.js";

export const REQUEST_HEADER_ENTRY = "glaux.request.header";
export const MODEL_CALL_ENTRY = "glaux.model.call";

/** 请求头哈希：系统提示词与工具的名称、说明、参数（SDD 21 §9.1）。 */
export function headerHash(body: Pick<RequestHeaderBody, "prompt" | "tools">): string {
  const tools = body.tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }));
  return createHash("sha256").update(JSON.stringify({ prompt: body.prompt, tools })).digest("hex").slice(0, 16);
}

/** 组装请求头；`knownHashes` 是本分支已写过 `body` 的哈希，命中时省略 `body`（§7.1 规则 2）。 */
export function requestHeader(input: {
  commandId: string;
  body: RequestHeaderBody;
  provider: string;
  model: string;
  contextWindow: number;
  lang: string;
  permissionMode: string;
  knownHashes: ReadonlySet<string>;
}): RequestHeaderEntry {
  const hash = headerHash(input.body);
  return {
    command_id: input.commandId,
    hash,
    provider: input.provider,
    model: input.model,
    context_window: input.contextWindow,
    lang: input.lang,
    permission_mode: input.permissionMode,
    ...(input.knownHashes.has(hash) ? {} : { body: input.body }),
  };
}

/** 消息估算 token：各消息 `estimateTokens` 之和（pi 压缩判定在无 usage 时的同一口径）。 */
export function estimateMessages(messages: readonly AgentMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateTokens(message), 0);
}

function imageCount(message: AgentMessage): number {
  const content = (message as { content?: unknown }).content;
  return Array.isArray(content) ? content.filter((block: { type?: unknown }) => block?.type === "image").length : 0;
}

function textOf(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((block: { type?: unknown; text?: unknown }) => (block?.type === "text" && typeof block.text === "string" ? [block.text] : [])).join("\n");
}

/**
 * 插件 `context` 钩子组合前后的差异（§7.1 规则 5）：裁剪的图像块按同位置消息的图像数之差计；
 * 追加的消息是末尾超出原条数、且不在原列表中的消息（裁剪在原位置换成新对象，不算追加）。
 */
export function summarizeRequest(before: readonly AgentMessage[], after: readonly AgentMessage[]): ModelCallEntry["request"] {
  const original = new Set(before);
  let pruned = 0;
  for (let index = 0; index < Math.min(before.length, after.length); index += 1) {
    if (after[index] !== before[index]) pruned += Math.max(0, imageCount(before[index]!) - imageCount(after[index]!));
  }
  return {
    message_count: after.length,
    pruned_images: pruned,
    injected: after.slice(before.length).filter((message) => !original.has(message)).map((message) => ({ role: "user" as const, text: textOf(message) })),
    est_tokens: { messages: estimateMessages(after) },
  };
}

const NO_REQUEST: ModelCallEntry["request"] = { message_count: 0, pruned_images: 0, injected: [], est_tokens: { messages: 0 } };

/** 一条命令内的模型调用记录器：`context` 钩子给出请求摘要，assistant 消息事件给出计时。 */
export class ModelCallRecorder {
  private step = 0;
  private pending: ModelCallEntry["request"] | undefined;
  private current: { startedAt: number; firstTokenMs?: number; request: ModelCallEntry["request"] } | undefined;

  constructor(private readonly commandId: string, private readonly now: () => number = Date.now) {}

  onContext(before: readonly AgentMessage[], after: readonly AgentMessage[]): void {
    this.pending = summarizeRequest(before, after);
  }

  /** 返回本次模型调用结束时应写入的条目。 */
  onEvent(event: AgentHarnessEvent): ModelCallEntry | undefined {
    if (event.type !== "message_start" && event.type !== "message_update" && event.type !== "message_end") return undefined;
    if ((event.message as { role?: unknown }).role !== "assistant") return undefined;
    if (event.type === "message_start") {
      this.current = { startedAt: this.now(), request: this.pending ?? NO_REQUEST };
      this.pending = undefined;
      return undefined;
    }
    const current = this.current;
    if (!current) return undefined;
    if (event.type === "message_update") {
      current.firstTokenMs ??= this.now() - current.startedAt;
      return undefined;
    }
    this.current = undefined;
    this.step += 1;
    return {
      command_id: this.commandId,
      step: this.step,
      started_at: current.startedAt,
      ...(current.firstTokenMs !== undefined ? { first_token_ms: current.firstTokenMs } : {}),
      duration_ms: this.now() - current.startedAt,
      request: current.request,
    };
  }
}
