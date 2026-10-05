/**
 * SDD 21 §7.2：会话树 → 运行轨迹。只读，不另建存储。
 */
import type { AgentMessage, SessionTreeEntry } from "@earendil-works/pi-agent-core";

import type {
  ModelCallEntry,
  RequestHeaderBody,
  RequestHeaderEntry,
  RunOutcome,
  Trajectory,
  TrajectoryBlock,
  TrajectoryItem,
  TrajectoryTurn,
  TrajectoryUsage,
  TranscriptMessage,
} from "../contracts.js";
import { PERMISSION_DECISION_ENTRY } from "../permission/plugin.js";
import { estimateTextTokens } from "../pi/prompt-preview.js";
import { TOOL_TIMING_ENTRY } from "../pi/session-service.js";
import { redactStrings, redactText } from "../security/redact.js";
import { SUBAGENT_RUN_DETAILS_KIND } from "../subagents/run.js";
import { estimateMessages, MODEL_CALL_ENTRY, REQUEST_HEADER_ENTRY } from "./capture.js";

const ACCEPTED = "glaux.command.accepted";
const SETTLED = "glaux.command.settled";
const BUDGET = "glaux.budget";
const OUTCOMES: readonly string[] = ["completed", "aborted", "failed", "budget_exceeded"];

type Data = Record<string, unknown>;

function record(value: unknown): Data | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Data : undefined;
}

function timeOf(entry: SessionTreeEntry): number {
  return Date.parse(entry.timestamp);
}

/** pi 内容块 → 轨迹块；图像只留类型与字节数（§7.2 规则 8），字符串逐个脱敏（规则 7）。 */
export function toBlocks(content: unknown): TrajectoryBlock[] {
  if (typeof content === "string") return [{ type: "text", text: redactText(content) }];
  if (!Array.isArray(content)) return [];
  return content.flatMap((raw): TrajectoryBlock[] => {
    const block = record(raw);
    if (!block) return [];
    if (block.type === "text" && typeof block.text === "string") return [{ type: "text", text: redactText(block.text) }];
    if (block.type === "thinking" && typeof block.thinking === "string") return [{ type: "thinking", text: redactText(block.thinking) }];
    if (block.type === "image") {
      const data = typeof block.data === "string" ? block.data : "";
      return [{ type: "image", mimeType: typeof block.mimeType === "string" ? block.mimeType : "image/png", bytes: Math.floor(data.length * 3 / 4) }];
    }
    if (block.type === "toolCall" && typeof block.name === "string") {
      return [{
        type: "toolCall",
        id: typeof block.id === "string" ? block.id : "",
        name: block.name,
        arguments: redactStrings(record(block.arguments) ?? {}),
      }];
    }
    return [];
  });
}

function usageOf(value: unknown): TrajectoryUsage {
  const usage = record(value) ?? {};
  const num = (key: string) => (typeof usage[key] === "number" ? usage[key] as number : 0);
  return {
    input: num("input"),
    output: num("output"),
    cacheRead: num("cacheRead"),
    cacheWrite: num("cacheWrite"),
    ...(typeof usage.reasoning === "number" ? { reasoning: usage.reasoning } : {}),
  };
}

/** 子智能体过程中的图像块去掉数据（§9.3）。 */
function stripTranscriptImages(transcript: TranscriptMessage[]): TranscriptMessage[] {
  const strip = (content: unknown) => Array.isArray(content)
    ? content.map((block: Data) => (block?.type === "image" ? { ...block, data: "" } : block))
    : content;
  return redactStrings(transcript.map((message) => ({ ...message, content: strip(message.content) }) as TranscriptMessage));
}

export interface TurnDraft {
  turn: TrajectoryTurn;
  entries: SessionTreeEntry[];
  open: boolean;
}

/**
 * 按命令受理与结束记录切轮次（§7.2 规则 2、3）。重新生成的轮次沿用被重答那一轮的受理记录、
 * 带自己的结束记录，命令标识以结束记录为准。轮次之外的非消息条目（模型切换等）并入下一轮。
 */
export function splitTurns(entries: readonly SessionTreeEntry[]): TurnDraft[] {
  const drafts: TurnDraft[] = [];
  let pre: TurnDraft | undefined;
  let current: TurnDraft | undefined;
  let pending: SessionTreeEntry[] = [];
  const newTurn = (at: number, data: Data = {}): TurnDraft => {
    const draft: TurnDraft = {
      turn: {
        index: drafts.length + 1,
        ...(typeof data.command_id === "string" ? { command_id: data.command_id } : {}),
        ...(typeof data.command_type === "string" ? { command_type: data.command_type } : {}),
        started_at: at,
        outcome: "unknown",
        items: [],
      },
      entries: pending,
      open: true,
    };
    pending = [];
    drafts.push(draft);
    return draft;
  };
  for (const entry of entries) {
    if (entry.type === "custom" && entry.customType === ACCEPTED) {
      if (current) current.open = false;
      current = newTurn(timeOf(entry), record(entry.data));
      continue;
    }
    if (entry.type === "custom" && entry.customType === SETTLED) {
      const data = record(entry.data) ?? {};
      const target = current ?? newTurn(timeOf(entry), data);
      if (typeof data.command_id === "string") target.turn.command_id = data.command_id;
      if (typeof data.command_type === "string") target.turn.command_type = data.command_type;
      target.turn.outcome = typeof data.result === "string" && OUTCOMES.includes(data.result) ? data.result as RunOutcome : "unknown";
      target.turn.ended_at = timeOf(entry);
      target.open = false;
      current = undefined;
      continue;
    }
    if (current) {
      current.entries.push(entry);
      continue;
    }
    const content = entry.type === "message" || entry.type === "compaction";
    if (content && drafts.length === 0) {
      pre ??= { turn: { index: 0, started_at: timeOf(entry), outcome: "unknown", items: [] }, entries: [], open: false };
      pre.entries.push(entry);
    } else if (content) {
      current = newTurn(timeOf(entry));
      current.entries.push(entry);
    } else {
      pending.push(entry);
    }
  }
  if (pending.length) (drafts.at(-1) ?? pre)?.entries.push(...pending);
  return pre ? [pre, ...drafts] : drafts;
}

function compactionKept(entries: readonly SessionTreeEntry[], position: number): AgentMessage[] {
  const entry = entries[position];
  if (entry?.type !== "compaction") return [];
  if (entry.retainedTail) return entry.retainedTail;
  if (!entry.firstKeptEntryId) return [];
  const start = entries.findIndex((candidate) => candidate.id === entry.firstKeptEntryId);
  if (start < 0) return [];
  return entries.slice(start, position).flatMap((candidate) => (candidate.type === "message" ? [candidate.message] : []));
}

export function projectTrajectory(input: {
  sessionId: string;
  entries: readonly SessionTreeEntry[];
  /** 正在运行的命令；该命令所在的未结束轮次记为 `running`。 */
  running: boolean;
}): Trajectory {
  const { entries } = input;
  const headers: Record<string, RequestHeaderBody> = {};
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== REQUEST_HEADER_ENTRY) continue;
    const data = entry.data as Partial<RequestHeaderEntry> | undefined;
    if (typeof data?.hash === "string" && data.body && !headers[data.hash]) headers[data.hash] = redactStrings(data.body);
  }
  const drafts = splitTurns(entries);
  const positions = new Map(entries.map((entry, index) => [entry.id, index]));
  const totals = { turns: 0, model_calls: 0, tool_calls: 0, usage: { input: 0, output: 0, cache_read: 0, cache_write: 0 } };
  let previousHash: string | undefined;

  drafts.forEach((draft, draftIndex) => {
    const { turn } = draft;
    if (draft.open) turn.outcome = input.running && draftIndex === drafts.length - 1 ? "running" : "unknown";
    const items: TrajectoryItem[] = [];
    const calls: ModelCallEntry[] = [];
    const timings = new Map<string, Data[]>();
    let header: RequestHeaderEntry | undefined;
    for (const entry of draft.entries) {
      if (entry.type !== "custom") continue;
      const data = record(entry.data);
      if (!data) continue;
      if (entry.customType === MODEL_CALL_ENTRY) calls.push(data as unknown as ModelCallEntry);
      if (entry.customType === REQUEST_HEADER_ENTRY && typeof data.hash === "string") {
        header = data as unknown as RequestHeaderEntry;
      }
      if (entry.customType === TOOL_TIMING_ENTRY && typeof data.tool_call_id === "string") {
        timings.set(data.tool_call_id, [...(timings.get(data.tool_call_id) ?? []), data]);
      }
    }
    const body = header ? headers[header.hash] : undefined;
    if (header) {
      items.push({
        kind: "header",
        item_id: draft.entries.find((entry) => entry.type === "custom" && entry.customType === REQUEST_HEADER_ENTRY)!.id,
        at: turn.started_at ?? 0,
        hash: header.hash,
        provider: header.provider,
        model: header.model,
        context_window: header.context_window,
        lang: header.lang,
        permission_mode: header.permission_mode,
        changed: previousHash === undefined ? "initial" : previousHash === header.hash ? "same" : "changed",
      });
      previousHash = header.hash;
    }

    const toolCalls = new Map<string, { name: string; arguments: Record<string, unknown> }>();
    let step = 0;
    for (const entry of draft.entries) {
      const at = timeOf(entry);
      if (entry.type === "message") {
        const message = entry.message as unknown as Data;
        if (message.role === "user") {
          items.push({ kind: "user", item_id: entry.id, at, content: toBlocks(message.content) });
        } else if (message.role === "assistant") {
          step += 1;
          const content = toBlocks(message.content);
          for (const block of content) {
            if (block.type === "toolCall") toolCalls.set(block.id, { name: block.name, arguments: block.arguments });
          }
          const call = calls.find((candidate) => candidate.step === step);
          const usage = usageOf(message.usage);
          totals.model_calls += 1;
          totals.usage.input += usage.input;
          totals.usage.output += usage.output;
          totals.usage.cache_read += usage.cacheRead;
          totals.usage.cache_write += usage.cacheWrite;
          items.push({
            kind: "model",
            item_id: entry.id,
            at,
            step,
            content,
            stop_reason: typeof message.stopReason === "string" ? message.stopReason : "",
            ...(typeof message.errorMessage === "string" ? { error_message: redactText(message.errorMessage) } : {}),
            usage,
            ...(call ? {
              timing: {
                started_at: call.started_at,
                ...(call.first_token_ms !== undefined ? { first_token_ms: call.first_token_ms } : {}),
                duration_ms: call.duration_ms,
              },
            } : {}),
            ...(call && body ? {
              request: {
                message_count: call.request.message_count,
                pruned_images: call.request.pruned_images,
                injected_count: call.request.injected.length,
                est_tokens: { system: body.est_tokens.prompt, tools: body.est_tokens.tools, messages: call.request.est_tokens.messages },
              },
            } : {}),
          });
        } else if (message.role === "toolResult") {
          const toolCallId = typeof message.toolCallId === "string" ? message.toolCallId : "";
          const origin = toolCalls.get(toolCallId);
          const timing = timings.get(toolCallId)?.shift();
          const details = record(message.details);
          totals.tool_calls += 1;
          items.push({
            kind: "tool",
            item_id: entry.id,
            at,
            tool_call_id: toolCallId,
            name: origin?.name ?? (typeof message.toolName === "string" ? message.toolName : ""),
            arguments: origin?.arguments ?? {},
            result: toBlocks(message.content),
            is_error: message.isError === true,
            blocked: timing?.blocked === true,
            ...(typeof timing?.duration_ms === "number" ? { duration_ms: timing.duration_ms } : {}),
            ...(typeof timing?.waited_ms === "number" ? { waited_ms: timing.waited_ms } : {}),
            ...(details?.kind === SUBAGENT_RUN_DETAILS_KIND ? {
              subagent: {
                subagent_type: String(details.subagent_type ?? ""),
                description: redactText(String(details.description ?? "")),
                outcome: String(details.outcome ?? ""),
                turns: typeof details.turns === "number" ? details.turns : 0,
                transcript: Array.isArray(details.transcript) ? stripTranscriptImages(details.transcript as TranscriptMessage[]) : [],
              },
            } : {}),
          });
        }
        continue;
      }
      if (entry.type === "compaction") {
        const kept = compactionKept(entries, positions.get(entry.id) ?? -1);
        items.push({
          kind: "compaction",
          item_id: entry.id,
          at,
          tokens_before: entry.tokensBefore,
          summary: redactText(entry.summary),
          summary_est_tokens: estimateTextTokens(entry.summary),
          kept: { count: kept.length, est_tokens: estimateMessages(kept) },
          ...(entry.usage ? { usage: usageOf(entry.usage) } : {}),
        });
        continue;
      }
      if (entry.type === "model_change") {
        items.push({ kind: "notice", item_id: entry.id, at, type: "model_change", data: { provider: entry.provider, model: entry.modelId } });
        continue;
      }
      if (entry.type !== "custom") continue;
      const data = record(entry.data);
      if (!data) continue;
      if (entry.customType === BUDGET && data.exhausted === true) {
        items.push({ kind: "notice", item_id: entry.id, at, type: "budget", data: redactStrings(data) });
      }
      if (entry.customType === PERMISSION_DECISION_ENTRY && (data.decision === "deny" || data.decision === "ask")) {
        items.push({ kind: "notice", item_id: entry.id, at, type: "permission", data: redactStrings(data) });
      }
    }
    turn.items = items;
    if (turn.index > 0) totals.turns += 1;
  });

  return {
    session_id: input.sessionId,
    // 轮次 0 没有条目时不出现（§7.2 规则 3）
    turns: drafts.map((draft) => draft.turn).filter((turn) => turn.index > 0 || turn.items.length > 0),
    headers,
    totals,
  };
}
