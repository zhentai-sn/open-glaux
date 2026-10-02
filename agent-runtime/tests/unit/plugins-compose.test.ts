/** SDD 15 §7.2：钩子组合器的短路、补丁合并、串联与异常隔离。 */
import type { AgentMessage, ToolCallEvent, ToolResultEvent } from "@earendil-works/pi-agent-core";
import { describe, expect, it, vi } from "vitest";

import { composeContext, composeToolCall, composeToolResult, installHooks } from "../../src/plugins/compose.js";
import type { GlauxPlugin, RunContext } from "../../src/plugins/types.js";

const ctx: RunContext = { sessionId: "s", commandId: "c" };
const call: ToolCallEvent = { type: "tool_call", toolCallId: "t1", toolName: "run_task", input: {} };
const result: ToolResultEvent = {
  type: "tool_result", toolCallId: "t1", toolName: "run_task", input: {},
  content: [{ type: "text", text: "raw" }], details: { n: 1 }, isError: false,
};

function plugin(name: string, hooks: NonNullable<GlauxPlugin["hooks"]>): GlauxPlugin {
  return { name, applies: () => true, hooks };
}

const silent = vi.fn();

describe("composeToolCall", () => {
  it("returns the first block and skips later plugins", async () => {
    const later = vi.fn(async () => undefined);
    const out = await composeToolCall([
      plugin("pass", { tool_call: async () => undefined }),
      plugin("deny", { tool_call: async () => ({ block: true, reason: "denied" }) }),
      plugin("later", { tool_call: later }),
    ], call, ctx, silent);
    expect(out).toEqual({ block: true, reason: "denied" });
    expect(later).not.toHaveBeenCalled();
  });

  it("allows when no plugin blocks", async () => {
    expect(await composeToolCall([plugin("pass", { tool_call: async () => ({ block: false }) })], call, ctx, silent)).toBeUndefined();
  });

  it("turns a throwing hook into a block and logs it", async () => {
    const logger = vi.fn();
    const out = await composeToolCall([plugin("boom", { tool_call: async () => { throw new Error("x"); } })], call, ctx, logger);
    expect(out).toEqual({ block: true, reason: "internal_error" });
    expect(logger).toHaveBeenCalledWith("plugin hook failed", expect.objectContaining({ plugin: "boom", hook: "tool_call" }));
  });
});

describe("composeToolResult", () => {
  it("feeds each plugin the previous patch and merges fields", async () => {
    const seen: unknown[] = [];
    const out = await composeToolResult([
      plugin("a", { tool_result: async () => ({ content: [{ type: "text", text: "patched" }], terminate: true }) }),
      plugin("b", { tool_result: async (event) => { seen.push(event.content); return { details: { n: 2 } }; } }),
    ], result, ctx, silent);
    expect(seen).toEqual([[{ type: "text", text: "patched" }]]);
    expect(out).toEqual({ content: [{ type: "text", text: "patched" }], details: { n: 2 }, terminate: true });
  });

  it("ignores the patch of a throwing plugin", async () => {
    const out = await composeToolResult([
      plugin("boom", { tool_result: async () => { throw new Error("x"); } }),
      plugin("ok", { tool_result: async () => ({ isError: true }) }),
    ], result, ctx, silent);
    expect(out).toEqual({ isError: true });
  });
});

describe("composeContext", () => {
  const messages = [{ role: "user", content: "hi", timestamp: 0 }] as AgentMessage[];

  it("pipes the output of each plugin into the next", async () => {
    const out = await composeContext([
      plugin("a", { context: async (m) => [...m, ...m] }),
      plugin("b", { context: async (m) => m.slice(1) }),
    ], messages, ctx, silent);
    expect(out).toHaveLength(1);
  });

  it("keeps the input of a throwing plugin", async () => {
    const out = await composeContext([plugin("boom", { context: async () => { throw new Error("x"); } })], messages, ctx, silent);
    expect(out).toBe(messages);
  });
});

describe("installHooks", () => {
  it("registers one handler per declared hook type and none for undeclared ones", () => {
    const on = vi.fn((_type: string, _handler: unknown) => () => undefined);
    installHooks({ on } as never, [
      plugin("a", { tool_call: async () => undefined }),
      plugin("b", { tool_call: async () => undefined, context: async (m) => m }),
    ], ctx, silent);
    expect(on.mock.calls.map(([type]) => type)).toEqual(["tool_call", "context"]);
  });
});
