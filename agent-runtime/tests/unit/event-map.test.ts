/** SDD 15 §7.10、§9.5、§9.6：pi 事件白名单映射与消息转换。 */
import type { AgentHarnessEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";

import { mapPiEvent } from "../../src/transport/event-map.js";
import { toTranscript } from "../../src/transport/transcript.js";

const map = (event: unknown) => mapPiEvent("s1", "c1", event as AgentHarnessEvent);

describe("mapPiEvent", () => {
  it("maps assistant message_update to message.delta and drops thinking blocks", () => {
    expect(map({
      type: "message_update",
      message: { role: "assistant", content: [{ type: "thinking", thinking: "hm" }, { type: "text", text: "hi" }] },
    })).toEqual({
      event: "message.delta",
      data: { session_id: "s1", command_id: "c1", message: { role: "assistant", content: [{ type: "text", text: "hi" }] } },
    });
  });

  it("ignores updates of non-assistant messages", () => {
    expect(map({ type: "message_update", message: { role: "user", content: "x" } })).toBeNull();
  });

  it("maps tool execution start and end", () => {
    expect(map({ type: "tool_execution_start", toolCallId: "t", toolName: "run_task", args: { a: 1 } })).toEqual({
      event: "tool.start",
      data: { session_id: "s1", command_id: "c1", tool_call_id: "t", tool_name: "run_task", args: { a: 1 } },
    });
    expect(map({
      type: "tool_execution_end", toolCallId: "t", toolName: "run_task", isError: false,
      result: { content: [{ type: "text", text: "ok" }], details: { kind: "k" } },
    })).toEqual({
      event: "tool.end",
      data: { session_id: "s1", command_id: "c1", tool_call_id: "t", tool_name: "run_task", is_error: false, details: { kind: "k" } },
    });
  });

  it("carries error text only for failed tools, truncated", () => {
    const mapped = map({
      type: "tool_execution_end", toolCallId: "t", toolName: "read_file", isError: true,
      result: { content: [{ type: "text", text: "x".repeat(3000) }] },
    });
    expect(mapped?.event).toBe("tool.end");
    expect((mapped?.data as { error_text?: string }).error_text).toHaveLength(2000);
  });

  it("redacts credentials in mapped payloads", () => {
    const mapped = map({ type: "tool_execution_start", toolCallId: "t", toolName: "x", args: { header: "Authorization: Bearer abc-secret-123" } });
    expect(JSON.stringify(mapped)).not.toContain("abc-secret-123");
  });

  it("maps message_end and session_compact, drops everything else", () => {
    expect(map({ type: "message_end", message: {} })?.event).toBe("message.end");
    expect(map({ type: "session_compact" })).toEqual({ event: "context.compacted", data: { session_id: "s1" } });
    for (const type of ["agent_start", "agent_end", "turn_start", "turn_end", "message_start", "tool_execution_update", "queue_update", "save_point", "settled", "tools_update"]) {
      expect(map({ type })).toBeNull();
    }
  });
});

describe("toTranscript", () => {
  it("keeps declared fields of tool results and drops provider metadata", () => {
    const message = {
      role: "toolResult", toolCallId: "t", toolName: "run_task", isError: false, timestamp: 1,
      content: [{ type: "image", data: "AAAA", mimeType: "image/png" }], details: { kind: "k" },
    } as unknown as AgentMessage;
    expect(toTranscript(message)).toEqual({
      role: "toolResult", toolCallId: "t", toolName: "run_task", isError: false,
      content: [{ type: "image", data: "AAAA", mimeType: "image/png" }], details: { kind: "k" },
    });
  });

  it("keeps tool calls of assistant messages and string user content", () => {
    expect(toTranscript({ role: "user", content: "hi", timestamp: 1 } as AgentMessage)).toEqual({ role: "user", content: "hi" });
    expect(toTranscript({
      role: "assistant", content: [{ type: "toolCall", id: "t", name: "run_task", arguments: { a: 1 } }],
      provider: "p", model: "m", usage: {}, stopReason: "toolUse", timestamp: 1,
    } as unknown as AgentMessage)).toEqual({
      role: "assistant", content: [{ type: "toolCall", id: "t", name: "run_task", arguments: { a: 1 } }],
    });
  });

  it("drops unknown roles", () => {
    expect(toTranscript({ role: "custom" } as unknown as AgentMessage)).toBeNull();
  });
});
