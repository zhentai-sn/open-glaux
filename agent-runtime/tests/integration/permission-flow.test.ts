/** SDD 15 §7.4～§7.6、§15.2：权限审批经 harness 的端到端流程。 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fauxAssistantMessage, fauxToolCall, Type, type FauxResponseStep } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PermissionMode, TransportEvent } from "../../src/contracts.js";
import type { PermissionDeps } from "../../src/permission/plugin.js";
import { EMPTY_SETTINGS, loadSettings, userSettingsPath } from "../../src/permission/settings.js";
import type { HarnessTool } from "../../src/pi/harness-registry.js";
import { TEST_CONNECTION, createRuntimeFixture, waitFor } from "../helpers/runtime-fixture.js";

/** 与注册表同名的替身：effect 取自插件登记表（run_task 为 compute）。 */
function countingRunTask(counter: { runs: number }): HarnessTool {
  return {
    name: "run_task",
    label: "run task",
    description: "test double",
    parameters: Type.Object({}),
    async execute() {
      counter.runs += 1;
      return { content: [{ type: "text", text: "measured" }], details: {} };
    },
  };
}

function toolResultTexts(messages: unknown[]): string[] {
  return messages
    .filter((m) => (m as { role?: string }).role === "toolResult")
    .map((m) => (m as { content: { text?: string }[] }).content.map((b) => b.text ?? "").join(""));
}

const callRunTask = () => fauxAssistantMessage(fauxToolCall("run_task", {}), { stopReason: "toolUse" });

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "glaux-permission-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

async function setup(steps: FauxResponseStep[][], mode: PermissionMode, permission?: PermissionDeps) {
  const counter = { runs: 0 };
  const fixture = await createRuntimeFixture(steps, {
    toolFactory: () => [countingRunTask(counter)],
    ...(permission ? { permission } : {}),
  });
  const sessionId = crypto.randomUUID();
  const events: TransportEvent[] = [];
  await fixture.sessions.createSession({ session_id: sessionId, permission_mode: mode });
  fixture.registry.subscribe(sessionId, (event) => events.push(event));
  const prompt = async (id = sessionId) => {
    await fixture.commands.accept(id, { command_id: crypto.randomUUID(), type: "prompt", content: "measure", connection: TEST_CONNECTION });
  };
  return { fixture, sessionId, events, counter, prompt };
}

async function nextRequest(fixture: Awaited<ReturnType<typeof createRuntimeFixture>>, sessionId: string) {
  await waitFor(() => fixture.registry.interactions.pending(sessionId).length === 1);
  return fixture.registry.interactions.pending(sessionId)[0]!;
}

describe("permission flow", () => {
  it("asks in suggest mode and runs after a one-time approval", async () => {
    const seen: string[][] = [];
    const { fixture, sessionId, counter, prompt } = await setup([[callRunTask(), (ctx) => { seen.push(toolResultTexts(ctx.messages)); return fauxAssistantMessage("done"); }]], "suggest");
    try {
      await prompt();
      const request = await nextRequest(fixture, sessionId);
      expect(request).toMatchObject({ kind: "permission", permission: { tool_name: "run_task", effect: "compute", grant_options: ["once", "session", "always"] } });
      fixture.registry.interactions.reply(sessionId, request.request_id, { kind: "permission", decision: "once" });
      await fixture.registry.waitForIdle(sessionId);
      expect(counter.runs).toBe(1);
      expect(seen).toEqual([["measured"]]);
      const view = await fixture.sessions.getSession(sessionId);
      expect(view.messages.find((m) => m.role === "toolResult")).not.toHaveProperty("blocked");
    } finally { await fixture.close(); }
  });

  it("returns the denial reason to the model without running the tool", async () => {
    const seen: string[][] = [];
    const { fixture, sessionId, counter, prompt, events } = await setup([[callRunTask(), (ctx) => { seen.push(toolResultTexts(ctx.messages)); return fauxAssistantMessage("ok"); }]], "suggest");
    try {
      await prompt();
      const request = await nextRequest(fixture, sessionId);
      fixture.registry.interactions.reply(sessionId, request.request_id, { kind: "permission", decision: "deny", reason: "not now" });
      await fixture.registry.waitForIdle(sessionId);
      expect(counter.runs).toBe(0);
      expect(seen[0]?.[0]).toMatch(/The user denied run_task: not now/u);
      // 被拦截的调用在实时事件与快照里都标为未执行（SDD 15 §5.1）
      expect(events.find((e) => e.event === "tool.end")?.data).toMatchObject({ is_error: true, blocked: true });
      const view = await fixture.sessions.getSession(sessionId);
      const result = view.messages.find((m) => m.role === "toolResult") as { duration_ms?: number; waited_ms?: number } | undefined;
      expect(result).toMatchObject({ isError: true, blocked: true, duration_ms: expect.any(Number) });
      // 等待审批的时长是总耗时的一部分（同一毫秒内回复时为 0，字段省略）
      expect(result!.waited_ms ?? 0).toBeLessThanOrEqual(result!.duration_ms!);
      const session = await fixture.sessions.openSession(sessionId);
      try {
        const decision = (await session.getEntries()).find((e) => e.type === "custom" && e.customType === "glaux.permission.decision");
        expect((decision as { data: unknown }).data).toMatchObject({ tool: "run_task", decision: "ask", basis: "mode", outcome: "answered", reply: "deny" });
      } finally { await fixture.sessions.closeSession(session); }
    } finally { await fixture.close(); }
  });

  it("remembers a session grant across commands of the same session only", async () => {
    const { fixture, sessionId, counter, prompt } = await setup([
      [callRunTask(), fauxAssistantMessage("first")],
      [callRunTask(), fauxAssistantMessage("second")],
      [callRunTask(), fauxAssistantMessage("third")],
    ], "suggest");
    try {
      await prompt();
      const request = await nextRequest(fixture, sessionId);
      fixture.registry.interactions.reply(sessionId, request.request_id, { kind: "permission", decision: "session" });
      await fixture.registry.waitForIdle(sessionId);
      await prompt();
      await fixture.registry.waitForIdle(sessionId);
      expect(counter.runs).toBe(2);

      const other = crypto.randomUUID();
      await fixture.sessions.createSession({ session_id: other, permission_mode: "suggest" });
      await prompt(other);
      const otherRequest = await nextRequest(fixture, other);
      expect(otherRequest.permission?.tool_name).toBe("run_task");
      fixture.registry.interactions.reply(other, otherRequest.request_id, { kind: "permission", decision: "deny" });
      await fixture.registry.waitForIdle(other);
    } finally { await fixture.close(); }
  });

  it("writes an allow rule for 'always' and stops asking in new sessions", async () => {
    const env = { GLAUX_HOME: dir };
    const permission: PermissionDeps = {
      loadSettings: async () => ({ settings: await loadSettings({ env }), alwaysPath: userSettingsPath(env) }),
    };
    const { fixture, sessionId, counter, prompt } = await setup([
      [callRunTask(), fauxAssistantMessage("first")],
      [callRunTask(), fauxAssistantMessage("second")],
    ], "suggest", permission);
    try {
      await prompt();
      const request = await nextRequest(fixture, sessionId);
      fixture.registry.interactions.reply(sessionId, request.request_id, { kind: "permission", decision: "always" });
      await fixture.registry.waitForIdle(sessionId);
      expect(JSON.parse(await readFile(userSettingsPath(env), "utf8"))).toEqual({ permissions: { rules: [{ tool: "run_task", decision: "allow" }] } });

      const other = crypto.randomUUID();
      await fixture.sessions.createSession({ session_id: other, permission_mode: "suggest" });
      await prompt(other);
      await fixture.registry.waitForIdle(other);
      expect(counter.runs).toBe(2);
      expect(fixture.registry.interactions.pending(other)).toEqual([]);
    } finally { await fixture.close(); }
  });

  it("applies deny rules even in autonomous mode", async () => {
    const permission: PermissionDeps = {
      loadSettings: async () => ({
        settings: { ...EMPTY_SETTINGS, user: { path: "u", rules: [{ tool: "run_task", decision: "deny" }], budget: {} } },
        alwaysPath: join(dir, "settings.json"),
      }),
    };
    const seen: string[][] = [];
    const { fixture, sessionId, counter, prompt } = await setup([[callRunTask(), (ctx) => { seen.push(toolResultTexts(ctx.messages)); return fauxAssistantMessage("ok"); }]], "autonomous", permission);
    try {
      await prompt();
      await fixture.registry.waitForIdle(sessionId);
      expect(counter.runs).toBe(0);
      expect(seen[0]?.[0]).toMatch(/denied by a permission rule/u);
    } finally { await fixture.close(); }
  });

  it("applies a downgrade made during the command to the next tool call", async () => {
    let sessionRef = "";
    let fixtureRef: Awaited<ReturnType<typeof createRuntimeFixture>> | undefined;
    const { fixture, sessionId, counter, events, prompt } = await setup([[
      callRunTask(),
      async () => {
        await fixtureRef!.sessions.patchSession(sessionRef, { permission_mode: "suggest" });
        return callRunTask();
      },
      fauxAssistantMessage("done"),
    ]], "controlled");
    fixtureRef = fixture;
    sessionRef = sessionId;
    try {
      await prompt();
      const request = await nextRequest(fixture, sessionId);
      expect(counter.runs).toBe(1);
      fixture.registry.interactions.reply(sessionId, request.request_id, { kind: "permission", decision: "once" });
      await fixture.registry.waitForIdle(sessionId);
      expect(counter.runs).toBe(2);
      expect(events.filter((e) => e.event === "interaction.request")).toHaveLength(1);
    } finally { await fixture.close(); }
  });

  it("cancels a pending approval when the command is aborted", async () => {
    const { fixture, sessionId, counter, events, prompt } = await setup([[callRunTask(), fauxAssistantMessage("never")]], "suggest");
    try {
      await prompt();
      await nextRequest(fixture, sessionId);
      await fixture.commands.accept(sessionId, { command_id: crypto.randomUUID(), type: "abort" });
      await fixture.registry.waitForIdle(sessionId);
      expect(counter.runs).toBe(0);
      expect(events.find((e) => e.event === "interaction.resolved")?.data).toMatchObject({ outcome: "cancelled" });
    } finally { await fixture.close(); }
  });

  it("surfaces settings warnings in the snapshot", async () => {
    const permission: PermissionDeps = {
      loadSettings: async () => ({
        settings: { ...EMPTY_SETTINGS, warnings: [{ code: "settings_invalid", message: "Settings file ignored: not valid JSON", path: "/x/settings.json" }] },
        alwaysPath: join(dir, "settings.json"),
      }),
    };
    const { fixture, sessionId, prompt } = await setup([[fauxAssistantMessage("hi")]], "controlled", permission);
    try {
      await prompt();
      await fixture.registry.waitForIdle(sessionId);
      expect((await fixture.sessions.getSession(sessionId)).warnings).toEqual([expect.objectContaining({ code: "settings_invalid", path: "/x/settings.json" })]);
    } finally { await fixture.close(); }
  });
});
