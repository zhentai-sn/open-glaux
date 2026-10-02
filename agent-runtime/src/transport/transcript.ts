/** SDD 15 §7.10 规则 2：pi-ai 消息 → Glaux `TranscriptMessage`。未声明的块（thinking 等）丢弃。 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";

import type { TranscriptBlock, TranscriptMessage } from "../contracts.js";

function toBlocks(content: unknown): TranscriptBlock[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((raw): TranscriptBlock[] => {
    if (!raw || typeof raw !== "object") return [];
    const block = raw as Record<string, unknown>;
    if (block.type === "text" && typeof block.text === "string") return [{ type: "text", text: block.text }];
    if (block.type === "image" && typeof block.data === "string") {
      return [{ type: "image", data: block.data, mimeType: typeof block.mimeType === "string" ? block.mimeType : "image/png" }];
    }
    if (block.type === "toolCall" && typeof block.name === "string") {
      return [{
        type: "toolCall",
        id: typeof block.id === "string" ? block.id : "",
        name: block.name,
        arguments: block.arguments && typeof block.arguments === "object" ? block.arguments as Record<string, unknown> : {},
      }];
    }
    return [];
  });
}

export function toTranscript(message: AgentMessage): TranscriptMessage | null {
  const raw = message as unknown as Record<string, unknown>;
  if (raw.role === "user") {
    return { role: "user", content: typeof raw.content === "string" ? raw.content : toBlocks(raw.content) };
  }
  if (raw.role === "assistant") return { role: "assistant", content: toBlocks(raw.content) };
  if (raw.role === "toolResult") {
    return {
      role: "toolResult",
      toolCallId: typeof raw.toolCallId === "string" ? raw.toolCallId : "",
      toolName: typeof raw.toolName === "string" ? raw.toolName : "",
      content: toBlocks(raw.content),
      ...(raw.details !== undefined ? { details: raw.details } : {}),
      isError: raw.isError === true,
    };
  }
  return null;
}
