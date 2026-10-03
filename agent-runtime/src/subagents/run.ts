/**
 * SDD 18 §7.2、§7.3：子智能体运行。内存会话、父连接、工具子集、共用权限状态、独立回合预算、级联中止；
 * 只把最终回复交回主智能体，过程压缩后放进工具结果的 details。
 */
import { AgentHarness, InMemorySessionRepo, type AgentMessage } from "@earendil-works/pi-agent-core";

import { RunBudget } from "../budget/run-budget.js";
import { installWindDown } from "../budget/wind-down.js";
import type { TranscriptBlock, TranscriptMessage } from "../contracts.js";
import type { HarnessTool } from "../pi/harness-registry.js";
import type { ModelRuntime } from "../pi/model-runtime.js";
import { installHooks } from "../plugins/compose.js";
import type { GlauxPlugin, RunContext } from "../plugins/types.js";
import type { AgentDefinition } from "../resources/agents.js";
import { toTranscript } from "../transport/transcript.js";

export const SUBAGENT_RUN_DETAILS_KIND = "glaux.subagent_run";
export const MAX_CONCURRENT_SUBAGENTS = 3;
const MAX_TRANSCRIPT_MESSAGES = 200;
const MAX_BLOCK_CHARS = 4000;

export type SubagentOutcome = "completed" | "budget_exceeded" | "aborted" | "failed";

export interface SubagentRequest {
  subagent_type: string;
  description: string;
  prompt: string;
}

export interface SubagentResult {
  outcome: SubagentOutcome;
  turns: number;
  final: string;
  transcript: TranscriptMessage[];
  error?: string;
}

export interface SubagentProgress {
  turns: number;
  tool_name?: string;
}

export interface SubagentRunDeps {
  definition: AgentDefinition;
  runtime: Pick<ModelRuntime, "models" | "model">;
  tools: HarnessTool[];
  systemPrompt: string;
  resources?: ConstructorParameters<typeof AgentHarness>[0]["resources"];
  plugins: GlauxPlugin[];
  runContext: RunContext;
  maxMinutes: number;
  /** 子智能体开始后等待用户回复的时长（毫秒），从时长预算中扣除。 */
  waitedMs?: () => number;
  signal?: AbortSignal;
  /** 每回合开始与每次工具调用开始时回调（SDD 18 §7.5）。 */
  onProgress?: (progress: SubagentProgress) => void;
}

function compactBlock(block: TranscriptBlock): TranscriptBlock {
  if (block.type === "image") return { type: "text", text: "[image omitted]" };
  if (block.type === "text" && block.text.length > MAX_BLOCK_CHARS) {
    return { type: "text", text: `${block.text.slice(0, MAX_BLOCK_CHARS)}…[truncated]` };
  }
  return block;
}

/** §7.3 规则 3：图像换占位、长文本截断、只留最后 200 条。 */
export function compactTranscript(messages: AgentMessage[]): TranscriptMessage[] {
  return messages
    .map((message) => toTranscript(message))
    .filter((message): message is TranscriptMessage => !!message)
    .map((message): TranscriptMessage => {
      if (typeof message.content === "string") {
        const block = compactBlock({ type: "text", text: message.content });
        return { ...message, content: block.type === "text" ? block.text : message.content } as TranscriptMessage;
      }
      return { ...message, content: (message.content as TranscriptBlock[]).map(compactBlock) } as TranscriptMessage;
    })
    .slice(-MAX_TRANSCRIPT_MESSAGES);
}

function lastAssistantText(messages: AgentMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as { role?: string; content?: unknown };
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    const text = message.content
      .filter((block: { type?: string }) => block.type === "text")
      .map((block: { text?: string }) => block.text ?? "")
      .join("")
      .trim();
    if (text) return text;
  }
  return "";
}

export async function runSubagent(prompt: string, deps: SubagentRunDeps): Promise<SubagentResult> {
  const session = await new InMemorySessionRepo().create();
  const harness = new AgentHarness({
    session,
    models: deps.runtime.models,
    model: deps.runtime.model,
    systemPrompt: deps.systemPrompt,
    tools: deps.tools,
    ...(deps.resources ? { resources: deps.resources } : {}),
  });
  const budget = new RunBudget({
    limits: { maxTurns: deps.definition.maxTurns, maxMinutes: deps.maxMinutes },
    waitedMs: deps.waitedMs ?? (() => 0),
    onAbort: () => { setImmediate(() => void harness.abort()); },
  });
  const uninstallHooks = installHooks(harness, deps.plugins, { ...deps.runContext, budget });
  const uninstallWindDown = installWindDown(harness, budget);
  const uninstall = () => { uninstallHooks(); uninstallWindDown(); };
  const unsubscribe = harness.subscribe((event) => {
    if (event.type === "turn_start") {
      budget.onTurnStart();
      deps.onProgress?.({ turns: budget.turns });
    } else if (event.type === "tool_execution_start") {
      deps.onProgress?.({ turns: budget.turns, tool_name: event.toolName });
    }
  });
  const onAbort = () => { void harness.abort(); };
  if (deps.signal?.aborted) onAbort();
  deps.signal?.addEventListener("abort", onAbort, { once: true });

  let outcome: SubagentOutcome = "completed";
  let error: string | undefined;
  try {
    const message = await harness.prompt(prompt);
    if (message.stopReason === "aborted") outcome = budget.abortedByBudget ? "budget_exceeded" : "aborted";
    else if (message.stopReason === "error") {
      outcome = "failed";
      error = message.errorMessage ?? "model request failed";
    }
  } catch (caught) {
    outcome = deps.signal?.aborted ? "aborted" : budget.abortedByBudget ? "budget_exceeded" : "failed";
    error = caught instanceof Error ? caught.message : String(caught);
  } finally {
    budget.dispose();
    unsubscribe();
    uninstall();
    deps.signal?.removeEventListener("abort", onAbort);
  }
  const messages = (await session.buildContext()).messages;
  return {
    outcome,
    turns: budget.turns,
    final: lastAssistantText(messages),
    transcript: compactTranscript(messages),
    ...(error ? { error } : {}),
  };
}

/** §7.2 规则 7：同一主命令内的并发槽位；中止信号到达时放弃排队。 */
export function createSlots(limit: number = MAX_CONCURRENT_SUBAGENTS) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return {
    get active() { return active; },
    async acquire(signal?: AbortSignal): Promise<() => void> {
      while (active >= limit) {
        if (signal?.aborted) throw new Error("aborted while waiting for a sub-agent slot");
        await new Promise<void>((resolve) => {
          waiting.push(resolve);
          signal?.addEventListener("abort", () => resolve(), { once: true });
        });
      }
      active += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active -= 1;
        waiting.shift()?.();
      };
    },
  };
}
