/** SDD 15 §7.9：只保留最近 4 个含图像的工具结果中的图像。 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";

import { pruneImages } from "../../src/plugins/context-pruning.js";

const image = { type: "image", data: "AAAA", mimeType: "image/png" };
const result = (n: number) => ({ role: "toolResult", toolCallId: `t${n}`, toolName: "view_current_image", isError: false, timestamp: n, content: [{ type: "text", text: `frame ${n}` }, image] }) as unknown as AgentMessage;
const user = { role: "user", timestamp: 0, content: [{ type: "text", text: "look" }, image] } as unknown as AgentMessage;

describe("pruneImages", () => {
  it("keeps the images of the latest 4 tool results and replaces older ones", () => {
    const messages = [user, ...[1, 2, 3, 4, 5, 6].map(result)];
    const pruned = pruneImages(messages);
    const images = pruned.map((m) => ((m as unknown as { content: { type: string }[] }).content.filter((b) => b.type === "image").length));
    expect(images).toEqual([1, 0, 0, 1, 1, 1, 1]);
    expect((pruned[1] as unknown as { content: { text?: string }[] }).content[1]?.text).toMatch(/Image omitted: result of view_current_image/u);
    expect((pruned[1] as unknown as { content: { text?: string }[] }).content[0]?.text).toBe("frame 1");
  });

  it("does not modify the input messages", () => {
    const messages = [1, 2, 3, 4, 5].map(result);
    const before = JSON.stringify(messages);
    pruneImages(messages);
    expect(JSON.stringify(messages)).toBe(before);
  });

  it("returns the same array when nothing needs pruning", () => {
    const messages = [user, result(1)];
    expect(pruneImages(messages)).toBe(messages);
  });
});
