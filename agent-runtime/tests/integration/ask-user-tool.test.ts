/** SDD 15 §7.6、§7.7、§15.3：ask_user 经交互请求挂起，按回答、过期或中止继续。 */
import { fauxAssistantMessage, fauxToolCall, type FauxResponseStep } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import type { TransportEvent } from "../../src/contracts.js";
import { ASK_USER_TOOL_NAME, createAskUserTool } from "../../src/interaction/ask-user.js";
import type { HarnessToolFactory } from "../../src/pi/harness-registry.js";
import { buildServer } from "../../src/transport/server.js";
import { TEST_CONNECTION, createRuntimeFixture, waitFor } from "../helpers/runtime-fixture.js";

const askUserFactory: HarnessToolFactory = (ctx) => [
  createAskUserTool({ table: ctx.interactions!, sessionId: ctx.run!.sessionId, commandId: ctx.run!.commandId }) as never,
];

function lastToolResultText(messages: unknown[]): string {
  const result = [...messages].reverse().find((m) => (m as { role?: string }).role === "toolResult") as
    | { content: { type: string; text?: string }[] }
    | undefined;
  return result?.content.map((block) => block.text ?? "").join("") ?? "";
}

function script(seen: string[]): FauxResponseStep[][] {
  return [[
    fauxAssistantMessage(fauxToolCall(ASK_USER_TOOL_NAME, { question: "Which side?", options: ["left", "right"] }), { stopReason: "toolUse" }),
    (context) => {
      seen.push(lastToolResultText(context.messages));
      return fauxAssistantMessage("ok");
    },
  ]];
}

describe("ask_user through the harness", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => { await Promise.all(cleanups.splice(0).map((c) => c())); });

  async function start(seen: string[], interactionTimeoutMs?: number) {
    const fixture = await createRuntimeFixture(script(seen), {
      toolFactory: askUserFactory,
      ...(interactionTimeoutMs !== undefined ? { interactionTimeoutMs } : {}),
    });
    const server = buildServer({ routes: { sessions: fixture.sessions, commands: fixture.commands, registry: fixture.registry, broker: fixture.broker } });
    cleanups.push(async () => { await server.close(); await fixture.close(); });
    const sessionId = crypto.randomUUID();
    const events: TransportEvent[] = [];
    await fixture.sessions.createSession({ session_id: sessionId });
    fixture.registry.subscribe(sessionId, (event) => events.push(event));
    const commandId = crypto.randomUUID();
    await fixture.commands.accept(sessionId, { command_id: commandId, type: "prompt", content: "go", connection: TEST_CONNECTION });
    await waitFor(() => fixture.registry.interactions.pending(sessionId).length === 1 || events.some((e) => e.event === "interaction.resolved"));
    return { fixture, server, sessionId, commandId, events };
  }

  it("continues with the chosen option and exposes the request in the snapshot until answered", async () => {
    const seen: string[] = [];
    const { fixture, server, sessionId, events } = await start(seen);
    const snapshot = (await server.inject({ method: "GET", url: `/agent-api/v1/sessions/${sessionId}` })).json();
    expect(snapshot.pending_interactions).toHaveLength(1);
    const request = snapshot.pending_interactions[0];
    expect(request).toMatchObject({ kind: "question", question: { question: "Which side?", options: ["left", "right"], allow_free_text: true } });
    expect(events.some((e) => e.event === "interaction.request")).toBe(true);

    const url = `/agent-api/v1/sessions/${sessionId}/interactions/${request.request_id}`;
    const answered = await server.inject({ method: "POST", url, payload: { kind: "question", option: 1 } });
    expect(answered.statusCode).toBe(200);
    expect(answered.json()).toEqual({ request_id: request.request_id, outcome: "answered" });
    await fixture.registry.waitForIdle(sessionId);

    expect(seen).toEqual(["The user answered: right"]);
    const resolved = events.find((e) => e.event === "interaction.resolved");
    expect(resolved?.data).toMatchObject({ request_id: request.request_id, outcome: "answered" });
    const after = (await server.inject({ method: "GET", url: `/agent-api/v1/sessions/${sessionId}` })).json();
    expect(after.pending_interactions).toEqual([]);

    const session = await fixture.sessions.openSession(sessionId);
    try {
      const audit = (await session.getEntries()).filter((e) => e.type === "custom" && e.customType === "glaux.interaction");
      expect(audit).toHaveLength(1);
      expect((audit[0] as { data: unknown }).data).toMatchObject({ outcome: "answered", reply: { kind: "question", option: 1 } });
    } finally {
      await fixture.sessions.closeSession(session);
    }
  });

  it("enforces the reply contract: idempotent repeat, conflict, not found, invalid", async () => {
    const seen: string[] = [];
    const { fixture, server, sessionId } = await start(seen);
    const request = fixture.registry.interactions.pending(sessionId)[0]!;
    const url = `/agent-api/v1/sessions/${sessionId}/interactions/${request.request_id}`;

    expect((await server.inject({ method: "POST", url, payload: { kind: "question", option: 5 } })).statusCode).toBe(422);
    expect((await server.inject({ method: "POST", url, payload: { kind: "permission", decision: "once" } })).statusCode).toBe(422);
    expect((await server.inject({ method: "POST", url, payload: { kind: "question", option: 0, text: "both" } })).statusCode).toBe(422);
    expect((await server.inject({ method: "POST", url, payload: { kind: "question", text: "left, slightly" } })).statusCode).toBe(200);
    expect((await server.inject({ method: "POST", url, payload: { kind: "question", text: "left, slightly" } })).statusCode).toBe(200);
    const conflict = await server.inject({ method: "POST", url, payload: { kind: "question", option: 0 } });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("interaction_resolved");
    const missing = await server.inject({ method: "POST", url: `/agent-api/v1/sessions/${sessionId}/interactions/${crypto.randomUUID()}`, payload: { kind: "question", option: 0 } });
    expect(missing.statusCode).toBe(404);
    const otherSession = await server.inject({ method: "POST", url: `/agent-api/v1/sessions/${crypto.randomUUID()}/interactions/${request.request_id}`, payload: { kind: "question", option: 0 } });
    expect(otherSession.statusCode).toBe(404);
    await fixture.registry.waitForIdle(sessionId);
    expect(seen).toEqual(["The user answered: left, slightly"]);
  });

  it("tells the model when the user does not reply in time", async () => {
    const seen: string[] = [];
    const { fixture, sessionId, events } = await start(seen, 30);
    await fixture.registry.waitForIdle(sessionId);
    expect(seen).toEqual(["The user did not reply."]);
    expect(events.find((e) => e.event === "interaction.resolved")?.data).toMatchObject({ outcome: "expired" });
  });

  it("cancels pending requests when the command is aborted", async () => {
    const seen: string[] = [];
    const { fixture, sessionId, events } = await start(seen);
    await fixture.commands.accept(sessionId, { command_id: crypto.randomUUID(), type: "abort" });
    await fixture.registry.waitForIdle(sessionId);
    expect(events.find((e) => e.event === "interaction.resolved")?.data).toMatchObject({ outcome: "cancelled" });
    expect(fixture.registry.interactions.pending(sessionId)).toEqual([]);
    expect(fixture.registry.getPhase(sessionId)).toBe("idle");
  });
});
