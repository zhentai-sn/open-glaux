// SDD 21 §7.4 规则 1：请求头差异。
import { describe, expect, it } from "vitest";

import type { RequestHeaderBody } from "../../../agent/runtime/types";
import { headerDiff, isEmptyDiff } from "./diff";

const body = (segments: RequestHeaderBody["segments"], tools: RequestHeaderBody["tools"]): RequestHeaderBody => ({
  prompt: "", segments, tools, est_tokens: { prompt: 0, tools: 0 },
});
const tool = (name: string, description = "d") => ({ name, plugin: "p", effect: "read", description, parameters: {}, est_tokens: 1 });

describe("headerDiff", () => {
  it("aligns segments by kind, plugin and scope and tools by name", () => {
    const previous = body(
      [
        { kind: "base", text: "b", est_tokens: 10 },
        { kind: "plugin", plugin: "files", text: "f", est_tokens: 4 },
        { kind: "instructions", scope: "user", text: "old", est_tokens: 2 },
        { kind: "viewer", text: "v", est_tokens: 3 },
      ],
      [tool("bash"), tool("read"), tool("grep")],
    );
    const next = body(
      [
        { kind: "base", text: "b", est_tokens: 10 },
        { kind: "instructions", scope: "user", text: "new text", est_tokens: 5 },
        { kind: "instructions", scope: "project", text: "p", est_tokens: 1 },
        { kind: "viewer", text: "v", est_tokens: 3 },
      ],
      [tool("bash", "changed"), tool("read"), tool("write")],
    );
    const diff = headerDiff(previous, next);
    expect(diff.segments).toEqual([
      { status: "changed", segment: expect.objectContaining({ kind: "instructions", scope: "user" }), delta: 3 },
      { status: "added", segment: expect.objectContaining({ kind: "instructions", scope: "project" }), delta: 1 },
      { status: "removed", segment: expect.objectContaining({ kind: "plugin", plugin: "files" }), delta: -4 },
    ]);
    expect(diff.tools).toEqual({ added: ["write"], removed: ["grep"], changed: ["bash"] });
    expect(isEmptyDiff(diff)).toBe(false);
  });

  it("is empty for identical headers", () => {
    const same = body([{ kind: "base", text: "b", est_tokens: 1 }], [tool("bash")]);
    expect(isEmptyDiff(headerDiff(same, same))).toBe(true);
  });
});
