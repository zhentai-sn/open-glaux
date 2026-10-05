/** SDD 21 §7.1、§7.2、§7.8：采集记录器与会话树投影。 */
import type { AgentHarnessEvent, AgentMessage, SessionTreeEntry } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";

import { ModelCallRecorder, requestHeader, summarizeRequest } from "../../src/trajectory/capture.js";
import { projectTrajectory } from "../../src/trajectory/project.js";

let seq = 0;
const ts = (n: number) => new Date(Date.UTC(2026, 9, 5, 0, 0, n)).toISOString();
function entry(body: Record<string, unknown>): SessionTreeEntry {
  seq += 1;
  return { id: `e${seq}`, parentId: seq > 1 ? `e${seq - 1}` : null, timestamp: ts(seq), ...body } as SessionTreeEntry;
}
const custom = (customType: string, data: Record<string, unknown>) => entry({ type: "custom", customType, data });
const user = (text: string) => entry({ type: "message", message: { role: "user", content: text, timestamp: 0 } });
const assistant = (content: unknown[], extra: Record<string, unknown> = {}) => entry({
  type: "message",
  message: { role: "assistant", content, stopReason: "stop", usage: { input: 10, output: 2, cacheRead: 1, cacheWrite: 0 }, timestamp: 0, ...extra },
});
const toolResult = (toolCallId: string, content: unknown[], extra: Record<string, unknown> = {}) => entry({
  type: "message", message: { role: "toolResult", toolCallId, toolName: "bash", content, isError: false, timestamp: 0, ...extra },
});
const accepted = (id: string) => custom("glaux.command.accepted", { command_id: id, command_type: "prompt", digest: "d" });
const settled = (id: string, result = "completed", type = "prompt") => custom("glaux.command.settled", { command_id: id, command_type: type, digest: "d", result });

describe("summarizeRequest", () => {
  it("counts in-place pruned images and appended messages separately", () => {
    const image = { role: "toolResult", content: [{ type: "image", data: "x" }, { type: "image", data: "y" }] } as unknown as AgentMessage;
    const text = { role: "user", content: "hi", timestamp: 0 } as AgentMessage;
    const pruned = { ...image, content: [{ type: "text", text: "[omitted]" }, { type: "text", text: "[omitted]" }] } as unknown as AgentMessage;
    const notice = { role: "user", content: [{ type: "text", text: "[Glaux] stop" }], timestamp: 0 } as AgentMessage;
    const summary = summarizeRequest([text, image], [text, pruned, notice]);
    expect(summary).toMatchObject({ message_count: 3, pruned_images: 2, injected: [{ role: "user", text: "[Glaux] stop" }] });
    expect(summary.est_tokens.messages).toBeGreaterThan(0);
  });
});

describe("ModelCallRecorder", () => {
  it("times each assistant message and numbers steps", () => {
    let now = 1000;
    const recorder = new ModelCallRecorder("cmd", () => now);
    const message = { role: "assistant", content: [] } as unknown as AgentMessage;
    const ev = (type: string) => ({ type, message, assistantMessageEvent: {} }) as unknown as AgentHarnessEvent;
    recorder.onContext([message], [message]);
    expect(recorder.onEvent({ type: "message_start", message: { role: "user" } } as unknown as AgentHarnessEvent)).toBeUndefined();
    recorder.onEvent(ev("message_start"));
    now = 1300; recorder.onEvent(ev("message_update"));
    now = 1400; recorder.onEvent(ev("message_update"));
    now = 2000;
    expect(recorder.onEvent(ev("message_end"))).toEqual({
      command_id: "cmd", step: 1, started_at: 1000, first_token_ms: 300, duration_ms: 1000,
      request: { message_count: 1, pruned_images: 0, injected: [], est_tokens: { messages: expect.any(Number) } },
    });
    recorder.onEvent(ev("message_start"));
    expect(recorder.onEvent(ev("message_end"))).toMatchObject({ step: 2, duration_ms: 0, request: { message_count: 0 } });
    expect(recorder.onEvent(ev("message_end"))?.step).toBeUndefined();
  });
});

describe("requestHeader", () => {
  const body = { prompt: "p", segments: [], tools: [], est_tokens: { prompt: 1, tools: 0 } };
  const input = { commandId: "c", body, provider: "x", model: "m", contextWindow: 10, lang: "en", permissionMode: "controlled" };
  it("omits the body for a hash already written on the branch", () => {
    const first = requestHeader({ ...input, knownHashes: new Set() });
    expect(first.body).toEqual(body);
    expect(requestHeader({ ...input, knownHashes: new Set([first.hash]) }).body).toBeUndefined();
    expect(requestHeader({ ...input, body: { ...body, prompt: "q" }, knownHashes: new Set([first.hash]) }).hash).not.toBe(first.hash);
  });
});

describe("projectTrajectory", () => {
  it("splits turns, pairs tools and model calls, and adopts the settled id of a regenerated turn", () => {
    seq = 0;
    const header = (id: string, hash: string, withBody = true) => custom("glaux.request.header", {
      command_id: id, hash, provider: "p", model: "m", context_window: 100, lang: "zh", permission_mode: "controlled",
      ...(withBody ? { body: { prompt: "P", segments: [], tools: [], est_tokens: { prompt: 7, tools: 3 } } } : {}),
    });
    const call = (id: string, step: number) => custom("glaux.model.call", {
      command_id: id, step, started_at: 5, first_token_ms: 1, duration_ms: 4,
      request: { message_count: step, pruned_images: 0, injected: [], est_tokens: { messages: 11 } },
    });
    const entries = [
      entry({ type: "model_change", provider: "p", modelId: "m" }),
      accepted("c1"),
      user("hello Bearer sk-secret"),
      assistant([{ type: "thinking", thinking: "hmm" }, { type: "toolCall", id: "t1", name: "bash", arguments: { command: "ls" } }], { stopReason: "toolUse" }),
      toolResult("t1", [{ type: "text", text: "a.txt" }]),
      assistant([{ type: "text", text: "done" }]),
      header("c1", "h1"),
      custom("glaux.tool.timing", { tool_call_id: "t1", duration_ms: 50, waited_ms: 20 }),
      custom("glaux.permission.decision", { tool_call_id: "t1", tool: "bash", effect: "exec", decision: "ask", outcome: "allow" }),
      call("c1", 1),
      call("c1", 2),
      settled("c1"),
      // 重新生成：沿用 c1 之后的受理记录不在本分支，条目接在结束记录之后
      user("hello again"),
      assistant([{ type: "text", text: "again" }]),
      header("c2", "h2"),
      settled("c2", "completed", "regenerate"),
      accepted("c3"),
      user("running"),
    ];
    const trajectory = projectTrajectory({ sessionId: "s", entries, running: true });

    expect(trajectory.turns.map((t) => [t.index, t.command_id, t.command_type, t.outcome])).toEqual([
      [1, "c1", "prompt", "completed"],
      [2, "c2", "regenerate", "completed"],
      [3, "c3", "prompt", "running"],
    ]);
    const [first, second] = trajectory.turns;
    expect(first!.items.map((i) => i.kind)).toEqual(["header", "notice", "user", "model", "tool", "model", "notice"]);
    expect(first!.items[1]).toMatchObject({ type: "model_change", data: { provider: "p", model: "m" } });
    expect(first!.items[2]).toMatchObject({ content: [{ type: "text", text: "hello Bearer [REDACTED]" }] });
    expect(first!.items[3]).toMatchObject({
      step: 1, stop_reason: "toolUse",
      content: [{ type: "thinking", text: "hmm" }, { type: "toolCall", name: "bash" }],
      timing: { started_at: 5, first_token_ms: 1, duration_ms: 4 },
      request: { message_count: 1, est_tokens: { system: 7, tools: 3, messages: 11 } },
    });
    expect(first!.items[4]).toMatchObject({ name: "bash", arguments: { command: "ls" }, duration_ms: 50, waited_ms: 20, blocked: false });
    expect(first!.items[6]).toMatchObject({ type: "permission", data: { decision: "ask", outcome: "allow" } });
    expect(second!.items.map((i) => i.kind)).toEqual(["header", "user", "model"]);
    expect(second!.items[0]).toMatchObject({ changed: "changed" });
    expect(Object.keys(trajectory.headers)).toEqual(["h1", "h2"]);
    expect(trajectory.totals).toEqual({ turns: 3, model_calls: 3, tool_calls: 1, usage: { input: 30, output: 6, cache_read: 3, cache_write: 0 } });
  });

  it("degrades for legacy sessions without accepted, header or model-call records", () => {
    seq = 0;
    const entries = [
      user("old"),
      assistant([{ type: "text", text: "old answer" }]),
      accepted("c1"),
      user("new"),
      assistant([{ type: "text", text: "x" }]),
    ];
    const trajectory = projectTrajectory({ sessionId: "s", entries, running: false });
    expect(trajectory.turns.map((t) => [t.index, t.outcome])).toEqual([[0, "unknown"], [1, "unknown"]]);
    const model = trajectory.turns[1]!.items.find((i) => i.kind === "model")!;
    expect(model).not.toHaveProperty("timing");
    expect(model).not.toHaveProperty("request");
    expect(trajectory.totals.turns).toBe(1);
  });

  it("strips image data, nests sub-agent transcripts and shows blocked tools", () => {
    seq = 0;
    const entries = [
      accepted("c1"),
      user("go"),
      assistant([{ type: "toolCall", id: "a1", name: "agent", arguments: {} }]),
      toolResult("a1", [{ type: "text", text: "final" }], {
        toolName: "agent",
        details: {
          kind: "glaux.subagent_run", subagent_type: "explore", description: "scan", outcome: "completed", turns: 2, final: "final",
          transcript: [{ role: "toolResult", toolCallId: "x", toolName: "view", isError: false, content: [{ type: "image", data: "QUJD", mimeType: "image/png" }] }],
        },
      }),
      custom("glaux.tool.timing", { tool_call_id: "a1", duration_ms: 9, blocked: true }),
      custom("glaux.budget", { command_id: "c1", turns: 5, exhausted: true }),
      settled("c1", "budget_exceeded"),
    ];
    const trajectory = projectTrajectory({ sessionId: "s", entries, running: false });
    const items = trajectory.turns[0]!.items;
    const tool = items.find((i) => i.kind === "tool");
    expect(tool).toMatchObject({ blocked: true, subagent: { subagent_type: "explore", turns: 2 } });
    expect(JSON.stringify(trajectory)).not.toContain("QUJD");
    expect(items.at(-1)).toMatchObject({ kind: "notice", type: "budget" });
    expect(trajectory.turns[0]!.outcome).toBe("budget_exceeded");
  });
});
