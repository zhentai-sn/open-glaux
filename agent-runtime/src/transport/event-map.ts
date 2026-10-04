/**
 * SDD 15 §7.10：pi 事件 → Glaux transport 事件。白名单映射，其余事件不下发。
 * 映射结果中的字符串逐个经 `redactText` 脱敏后再交给 SSE。
 */
import type { AgentHarnessEvent } from "@earendil-works/pi-agent-core";

import type { TransportEvent } from "../contracts.js";
import { redactStrings } from "../security/redact.js";
import { toTranscript } from "./transcript.js";

const MAX_ERROR_TEXT = 2000;

function resultText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block) => (block && typeof block === "object" && (block as { type?: unknown }).type === "text"
      ? [String((block as { text?: unknown }).text ?? "")] : []))
    .join("\n");
}

export type LiveEvent = Exclude<TransportEvent, { event: "snapshot" }>;

function redacted<T extends LiveEvent>(event: T): T {
  return redactStrings(event);
}

/** `tool.end` 的附加信息：被插件拦截的调用标识，与某次调用等待用户回复的时长。 */
export interface ToolEndContext {
  blocked?: ReadonlySet<string>;
  waitedMs?: (toolCallId: string) => number;
}

export function mapPiEvent(
  sessionId: string, commandId: string, event: AgentHarnessEvent, toolEnd: ToolEndContext = {},
): LiveEvent | null {
  const base = { session_id: sessionId, command_id: commandId };
  switch (event.type) {
    case "message_update": {
      if ((event.message as { role?: unknown }).role !== "assistant") return null;
      const message = toTranscript(event.message);
      return message ? redacted({ event: "message.delta", data: { ...base, message } }) : null;
    }
    case "message_end":
      return { event: "message.end", data: base };
    case "tool_execution_start":
      return redacted({
        event: "tool.start",
        data: { ...base, tool_call_id: event.toolCallId, tool_name: event.toolName, args: event.args ?? {} },
      });
    case "tool_execution_end": {
      const result = event.result as { details?: unknown; content?: unknown } | undefined;
      const waited = toolEnd.waitedMs?.(event.toolCallId) ?? 0;
      return redacted({
        event: "tool.end",
        data: {
          ...base,
          tool_call_id: event.toolCallId,
          tool_name: event.toolName,
          is_error: event.isError,
          ...(toolEnd.blocked?.has(event.toolCallId) ? { blocked: true as const } : {}),
          ...(waited > 0 ? { waited_ms: waited } : {}),
          details: result?.details ?? null,
          ...(event.isError ? { error_text: resultText(result?.content).slice(0, MAX_ERROR_TEXT) } : {}),
        },
      });
    }
    case "session_compact":
      return { event: "context.compacted", data: { session_id: sessionId } };
    default:
      return null;
  }
}
