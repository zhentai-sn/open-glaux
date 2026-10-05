/** SDD 21 §15.1：运行轨迹的采集、投影与请求重建（真实 harness + faux 模型）。 */
import { join } from "node:path";
import { tmpdir } from "node:os";

import { fauxAssistantMessage, fauxToolCall, Type, type Context, type FauxResponseStep } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import type { ModelCallEntry, RequestContext, RequestHeaderEntry, Trajectory } from "../../src/contracts.js";
import { EMPTY_SETTINGS } from "../../src/permission/settings.js";
import type { HarnessTool } from "../../src/pi/harness-registry.js";
import { buildServer } from "../../src/transport/server.js";
import { TEST_CONNECTION, createRuntimeFixture } from "../helpers/runtime-fixture.js";

const PNG = "aGVsbG8gd29ybGQ=";
const call = () => fauxAssistantMessage(fauxToolCall("run_task", {}), { stopReason: "toolUse" });

function tool(withImage = false): HarnessTool {
  return {
    name: "run_task", label: "run", description: "test double", parameters: Type.Object({}),
    async execute() {
      return {
        content: withImage ? [{ type: "image", data: PNG, mimeType: "image/png" }] : [{ type: "text", text: "ok" }],
        details: {},
      };
    },
  };
}

type Fixture = Awaited<ReturnType<typeof createRuntimeFixture>>;
let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); cleanup = undefined; });

async function setup(batches: FauxResponseStep[][], options: { image?: boolean; maxTurns?: number; contextWindow?: number } = {}) {
  const fixture = await createRuntimeFixture(batches, {
    toolFactory: () => [tool(options.image)],
    ...(options.contextWindow ? { contextWindow: options.contextWindow } : {}),
    ...(options.maxTurns ? {
      permission: {
        loadSettings: async () => ({
          settings: { ...EMPTY_SETTINGS, user: { path: "u", rules: [], budget: { max_turns: options.maxTurns! } } },
          alwaysPath: join(tmpdir(), "unused-settings.json"),
        }),
      },
    } : {}),
  });
  const server = buildServer({ routes: { sessions: fixture.sessions, commands: fixture.commands, registry: fixture.registry, broker: fixture.broker } });
  const sessionId = crypto.randomUUID();
  await fixture.sessions.createSession({ session_id: sessionId });
  cleanup = async () => { await server.close(); await fixture.close(); };
  return { fixture, server, sessionId };
}

async function prompt(fixture: Fixture, sessionId: string, content: string, connection = TEST_CONNECTION) {
  await fixture.commands.accept(sessionId, { command_id: crypto.randomUUID(), type: "prompt", content, connection });
  await fixture.registry.waitForIdle(sessionId);
  // 结束记录在 completion 之后落盘
  await new Promise((resolve) => setTimeout(resolve, 50));
}

async function customEntries<T>(fixture: Fixture, sessionId: string, type: string): Promise<T[]> {
  const session = await fixture.sessions.openSession(sessionId);
  try {
    return (await session.getEntries()).flatMap((entry) => (entry.type === "custom" && entry.customType === type ? [entry.data as T] : []));
  } finally {
    await fixture.sessions.closeSession(session);
  }
}

async function getTrajectory(server: ReturnType<typeof buildServer>, sessionId: string): Promise<Trajectory> {
  const response = await server.inject({ method: "GET", url: `/agent-api/v1/sessions/${sessionId}/trajectory` });
  expect(response.statusCode).toBe(200);
  return response.json();
}

async function getRequest(server: ReturnType<typeof buildServer>, sessionId: string, itemId: string): Promise<RequestContext> {
  const response = await server.inject({ method: "GET", url: `/agent-api/v1/sessions/${sessionId}/trajectory/requests/${itemId}` });
  expect(response.statusCode).toBe(200);
  return response.json();
}

function modelItems(trajectory: Trajectory) {
  return trajectory.turns.flatMap((turn) => turn.items).filter((item) => item.kind === "model");
}

describe("run trajectory", () => {
  it("records one header per command, de-duplicates its body and matches the real system prompt", async () => {
    const seen: string[] = [];
    const answer = (text: string) => (context: Context) => { seen.push(context.systemPrompt ?? ""); return fauxAssistantMessage(text); };
    const { fixture, server, sessionId } = await setup([
      [(context: Context) => { seen.push(context.systemPrompt ?? ""); return call(); }, answer("done")],
      [answer("again")],
    ]);
    await prompt(fixture, sessionId, "measure");
    await prompt(fixture, sessionId, "once more");

    const headers = await customEntries<RequestHeaderEntry>(fixture, sessionId, "glaux.request.header");
    expect(headers).toHaveLength(2);
    expect(headers[0]!.body?.prompt).toBe(seen[0]);
    expect(headers[0]!.body?.tools.map((t) => t.name)).toEqual(["run_task"]);
    expect(headers[1]!.hash).toBe(headers[0]!.hash);
    expect(headers[1]!.body).toBeUndefined();

    const calls = await customEntries<ModelCallEntry>(fixture, sessionId, "glaux.model.call");
    expect(calls.map((c) => c.step)).toEqual([1, 2, 1]);
    for (const c of calls) {
      expect(c.duration_ms).toBeGreaterThanOrEqual(0);
      if (c.first_token_ms !== undefined) expect(c.duration_ms).toBeGreaterThanOrEqual(c.first_token_ms);
    }

    const trajectory = await getTrajectory(server, sessionId);
    expect(trajectory.turns.map((t) => [t.index, t.outcome])).toEqual([[1, "completed"], [2, "completed"]]);
    expect(trajectory.turns[0]!.items.map((i) => i.kind)).toEqual(["header", "user", "model", "tool", "model"]);
    expect(trajectory.turns.map((t) => t.items[0])).toMatchObject([{ kind: "header", changed: "initial" }, { kind: "header", changed: "same" }]);
    expect(Object.keys(trajectory.headers)).toEqual([headers[0]!.hash]);
    expect(trajectory.totals).toMatchObject({ turns: 2, model_calls: 3, tool_calls: 1 });
    const first = modelItems(trajectory)[0]!;
    expect(first).toMatchObject({ step: 1, timing: { started_at: expect.any(Number) }, request: { message_count: 1 } });
    if (first.kind === "model") expect(first.request?.est_tokens.system).toBe(headers[0]!.body!.est_tokens.prompt);

    for (const item of modelItems(trajectory)) {
      const request = await getRequest(server, sessionId, item.item_id);
      expect(request.matched).toBe(true);
      expect(request.header_hash).toBe(headers[0]!.hash);
    }
    const second = await getRequest(server, sessionId, modelItems(trajectory)[1]!.item_id);
    expect(second.messages.map((m) => m.role)).toEqual(["user", "assistant", "toolResult"]);

    const notModel = trajectory.turns[0]!.items.find((i) => i.kind === "user")!;
    const missing = await server.inject({ method: "GET", url: `/agent-api/v1/sessions/${sessionId}/trajectory/requests/${notModel.item_id}` });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("trajectory_item_not_found");
  });

  it("counts pruned images and reconstructs the pruned request", async () => {
    const { fixture, server, sessionId } = await setup([[call(), call(), call(), call(), call(), fauxAssistantMessage("seen")]], { image: true });
    await prompt(fixture, sessionId, "look", { ...TEST_CONNECTION, vision: true });

    const calls = await customEntries<ModelCallEntry>(fixture, sessionId, "glaux.model.call");
    expect(calls.map((c) => c.request.pruned_images)).toEqual([0, 0, 0, 0, 0, 1]);
    const trajectory = await getTrajectory(server, sessionId);
    const tools = trajectory.turns[0]!.items.filter((i) => i.kind === "tool");
    expect(tools[0]).toMatchObject({ result: [{ type: "image", mimeType: "image/png", bytes: expect.any(Number) }] });
    expect(JSON.stringify(trajectory)).not.toContain(PNG);

    const last = await getRequest(server, sessionId, modelItems(trajectory).at(-1)!.item_id);
    expect(last.matched).toBe(true);
    expect(last.messages.filter((m) => m.marks.includes("pruned"))).toHaveLength(1);
    expect(JSON.stringify(last)).not.toContain(PNG);
  });

  it("records the wind-down notice injected by the budget plugin", async () => {
    const { fixture, server, sessionId } = await setup([[call(), call(), call(), fauxAssistantMessage("partial")]], { maxTurns: 3 });
    await prompt(fixture, sessionId, "go");

    const calls = await customEntries<ModelCallEntry>(fixture, sessionId, "glaux.model.call");
    expect(calls.at(-1)!.request.injected[0]!.text).toMatch(/^\[Glaux\] This run reached its budget/u);
    const trajectory = await getTrajectory(server, sessionId);
    const last = modelItems(trajectory).at(-1)!;
    expect(last).toMatchObject({ request: { injected_count: 1 } });
    const request = await getRequest(server, sessionId, last.item_id);
    expect(request.matched).toBe(true);
    expect(request.messages.at(-1)).toMatchObject({ role: "user", marks: ["injected"] });
    expect(trajectory.turns[0]!.items.some((i) => i.kind === "notice" && i.type === "budget")).toBe(true);
  });

  it("shows compaction and reconstructs the compacted request", async () => {
    const { fixture, server, sessionId } = await setup(
      [[fauxAssistantMessage("summary"), fauxAssistantMessage("after compact")]],
      { contextWindow: 40_000 },
    );
    const session = await fixture.sessions.openSession(sessionId);
    for (let index = 0; index < 12; index += 1) {
      await session.appendMessage({ role: "user", content: `${index}:${"x".repeat(12_000)}`, timestamp: Date.now() });
      await session.appendMessage({
        ...fauxAssistantMessage(`answer-${index}`),
        usage: {
          input: (index + 1) * 3000, output: 100, cacheRead: 0, cacheWrite: 0, totalTokens: (index + 1) * 3000 + 100,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      });
    }
    await fixture.sessions.closeSession(session);
    await prompt(fixture, sessionId, "continue", { ...TEST_CONNECTION, context_window: 40_000 });

    const trajectory = await getTrajectory(server, sessionId);
    // 预置的历史没有受理记录，归入轮次 0
    expect(trajectory.turns[0]).toMatchObject({ index: 0, outcome: "unknown" });
    expect(trajectory.turns[0]!.items.filter((i) => i.kind === "model")).toHaveLength(12);
    const turn = trajectory.turns.find((t) => t.index === 1)!;
    const compaction = turn.items.find((i) => i.kind === "compaction");
    expect(compaction).toMatchObject({ summary: expect.any(String), kept: { count: expect.any(Number) } });
    if (compaction?.kind === "compaction") expect(compaction.tokens_before).toBeGreaterThan(0);

    const request = await getRequest(server, sessionId, modelItems(trajectory).at(-1)!.item_id);
    expect(request.matched).toBe(true);
    expect(request.messages[0]!.role).toBe("compactionSummary");
  });
});
