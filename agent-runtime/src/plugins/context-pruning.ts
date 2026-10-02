/**
 * SDD 15 §7.9：上下文裁剪。每次模型请求前，只保留最近 4 个含图像的工具结果中的图像，
 * 更早的图像块换成文字占位。用户消息里的附件不动；只改发给模型的请求，不改会话存储。
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";

import type { GlauxPlugin } from "./types.js";

export const KEEP_IMAGE_RESULTS = 4;

interface Block { type?: unknown }

function hasImage(message: AgentMessage): boolean {
  const raw = message as { role?: unknown; content?: unknown };
  return raw.role === "toolResult" && Array.isArray(raw.content) && raw.content.some((block: Block) => block?.type === "image");
}

export function pruneImages(messages: AgentMessage[], keep = KEEP_IMAGE_RESULTS): AgentMessage[] {
  const withImages = messages.map((message, index) => (hasImage(message) ? index : -1)).filter((index) => index >= 0);
  const prune = new Set(withImages.slice(0, Math.max(0, withImages.length - keep)));
  if (!prune.size) return messages;
  return messages.map((message, index) => {
    if (!prune.has(index)) return message;
    const raw = message as unknown as { toolName?: unknown; content: Block[] };
    const tool = typeof raw.toolName === "string" ? raw.toolName : "tool";
    return {
      ...message,
      content: raw.content.map((block) => (block?.type === "image"
        ? { type: "text", text: `[Image omitted: result of ${tool}. Call it again if you need to see it.]` }
        : block)),
    } as AgentMessage;
  });
}

export const contextPruningPlugin: GlauxPlugin = {
  name: "context-pruning",
  applies: () => true,
  hooks: { context: async (messages) => pruneImages(messages) },
};
