/** SDD 18 §7.2～§7.4、§15：子智能体经 `agent` 工具运行的端到端流程。 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { fauxAssistantMessage, fauxToolCall, Type, type Context, type FauxResponseStep } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import type { PermissionMode, TransportEvent } from "../../src/contracts.js";
import { defaultToolFactory, type HarnessTool } from "../../src/pi/harness-registry.js";
import { TEST_CONNECTION, createRuntimeFixture, waitFor } from "../helpers/runtime-fixture.js";

function stubTool(name: string, counter: { runs: number }): HarnessTool {
  return {
    name,
    label: name,
    description: "test double",
    parameters: Type.Object({}),
    async execute() {
      counter.runs += 1;
      return { content: [{ type: "text", text: `${name} ran` }], details: {} };
    },
  };
}

const callAgent = (subagent_type = "scout") =>
  fauxAssistantMessage(fauxToolCall("agent", { subagent_type, description: "find files", prompt: "Count the cells" }), { stopReason: "toolUse" });
const call = (name: string, args: Record<string, unknown> = {}) => fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });

const toolResults = (context: Context) => context.messages
  .filter((m) => m.role === "toolResult")
  .map((m) => (m.content as { text?: string }[]).map((b) => b.text ?? "").join(""));

async function setup(steps: FauxResponseStep[], mode: PermissionMode, agentFront = "tools: [run_task]\n") {
  const counter = { runs: 0 };
  const fixture = await createRuntimeFixture([steps], {
    toolFactory: (ctx) => [
      ...defaultToolFactory(ctx).filter((tool) => tool.name === "agent" || tool.name === "ask_user"),
      stubTool("run_task", counter),
      stubTool("other_tool", counter),
    ],
  });
  await mkdir(join(fixture.dataDir, "builtin-agents"), { recursive: true });
  await writeFile(join(fixture.dataDir, "builtin-agents", "scout.md"), `---\nname: scout\ndescription: Finds things.\n${agentFront}---\n\nScout carefully.\n`);
  const sessionId = crypto.randomUUID();
  const events: TransportEvent[] = [];
  await fixture.sessions.createSession({ session_id: sessionId, permission_mode: mode });
  fixture.registry.subscribe(sessionId, (event) => events.push(event));
  await fixture.commands.accept(sessionId, { command_id: crypto.randomUUID(), type: "prompt", content: "go", connection: TEST_CONNECTION });
  return { fixture, sessionId, counter, events };
}

describe("sub-agents", () => {
  it("runs a sub-agent with only the prompt and its tools, returning only the final reply", async () => {
    const child: Context[] = [];
    const parentSaw: string[][] = [];
    const { fixture, sessionId, counter } = await setup([
      callAgent(),
      (context) => { child.push(context); return call("run_task"); },
      fauxAssistantMessage("child answer"),
      (context) => { parentSaw.push(toolResults(context)); return fauxAssistantMessage("done"); },
    ], "controlled");
    try {
      await fixture.registry.waitForIdle(sessionId);
      expect(counter.runs).toBe(1);
      expect(child[0]!.messages).toHaveLength(1);
      expect(child[0]!.messages[0]).toMatchObject({ role: "user" });
      expect(JSON.stringify(child[0]!.messages[0]!.content)).toContain("Count the cells");
      expect(child[0]!.systemPrompt).toContain('<subagent name="scout">\nScout carefully.\n</subagent>');
      expect(child[0]!.tools?.map((tool) => tool.name)).toEqual(["run_task"]);
      expect(parentSaw).toEqual([["child answer"]]);

      const view = await fixture.sessions.getSession(sessionId);
      const card = view.messages.find((m) => m.role === "toolResult");
      expect(card).toMatchObject({
        toolName: "agent",
        details: { kind: "glaux.subagent_run", subagent_type: "scout", description: "find files", outcome: "completed", turns: 2, final: "child answer" },
      });
      expect((card as { details: { transcript: unknown[] } }).details.transcript).toHaveLength(4);
    } finally { await fixture.close(); }
  });

  it("asks for delegation in suggest mode and labels the sub-agent's approvals with their origin", async () => {
    const { fixture, sessionId, counter } = await setup([
      callAgent(),
      call("run_task"),
      fauxAssistantMessage("ok"),
      fauxAssistantMessage("done"),
    ], "suggest");
    try {
      await waitFor(() => fixture.registry.interactions.pending(sessionId).length === 1);
      const delegate = fixture.registry.interactions.pending(sessionId)[0]!;
      expect(delegate.permission).toMatchObject({ tool_name: "agent", effect: "delegate" });
      expect(delegate.origin).toBeUndefined();
      fixture.registry.interactions.reply(sessionId, delegate.request_id, { kind: "permission", decision: "once" });

      await waitFor(() => fixture.registry.interactions.pending(sessionId).length === 1);
      const inner = fixture.registry.interactions.pending(sessionId)[0]!;
      expect(inner).toMatchObject({ permission: { tool_name: "run_task" }, origin: { subagent: "find files" } });
      fixture.registry.interactions.reply(sessionId, inner.request_id, { kind: "permission", decision: "once" });
      await fixture.registry.waitForIdle(sessionId);
      expect(counter.runs).toBe(1);

      const session = await fixture.sessions.openSession(sessionId);
      try {
        const decisions = (await session.getEntries()).filter((e) => e.type === "custom" && e.customType === "glaux.permission.decision");
        expect(decisions.map((e) => (e as { data: { tool: string } }).data.tool)).toEqual(["agent", "run_task"]);
      } finally { await fixture.sessions.closeSession(session); }
    } finally { await fixture.close(); }
  });

  it("stops tool calls once the definition's max_turns is used up", async () => {
    const parentSaw: string[][] = [];
    const { fixture, sessionId, counter } = await setup([
      callAgent(),
      call("run_task"),
      call("run_task"),
      fauxAssistantMessage("partial"),
      (context) => { parentSaw.push(toolResults(context)); return fauxAssistantMessage("done"); },
    ], "controlled", "tools: [run_task]\nmax_turns: 1\n");
    try {
      await fixture.registry.waitForIdle(sessionId);
      expect(counter.runs).toBe(1);
      expect(parentSaw).toEqual([["partial"]]);
    } finally { await fixture.close(); }
  });

  it("aborts the sub-agent with the main command and cancels its pending question", async () => {
    const { fixture, sessionId } = await setup([
      callAgent(),
      call("ask_user", { question: "Which folder?" }),
      fauxAssistantMessage("never"),
      fauxAssistantMessage("never"),
    ], "controlled", "");
    try {
      await waitFor(() => fixture.registry.interactions.pending(sessionId).length === 1);
      expect(fixture.registry.interactions.pending(sessionId)[0]).toMatchObject({ kind: "question", origin: { subagent: "find files" } });
      await fixture.registry.abort(sessionId);
      await fixture.registry.waitForIdle(sessionId);
      expect(fixture.registry.interactions.pending(sessionId)).toEqual([]);
      expect(fixture.registry.getPhase(sessionId)).toBe("idle");
    } finally { await fixture.close(); }
  });

  it("answers an unknown sub-agent type without running anything", async () => {
    const parentSaw: string[][] = [];
    const { fixture, sessionId } = await setup([
      callAgent("nobody"),
      (context) => { parentSaw.push(toolResults(context)); return fauxAssistantMessage("done"); },
    ], "controlled");
    try {
      await fixture.registry.waitForIdle(sessionId);
      expect(parentSaw[0]?.[0]).toBe('Unknown sub-agent "nobody". Available: scout.');
    } finally { await fixture.close(); }
  });
});
