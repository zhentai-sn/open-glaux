import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AgentHarness,
  DEFAULT_COMPACTION_SETTINGS,
  estimateContextTokens,
  shouldCompact,
  type AgentHarnessEvent,
} from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai";
import {
  createNodeSqliteFactory,
  SqliteSessionRepo,
} from "@earendil-works/pi-storage-sqlite-node";
import { describe, expect, it } from "vitest";

import {
  assertSupportedNodeVersion,
  REQUIRED_AGENT_EVENT_TYPES,
  toRuntimeProviderId,
} from "../../src/pi/compatibility.js";

async function createRepo() {
  const cwd = await mkdtemp(join(tmpdir(), "glaux-pi-compat-"));
  const env = new NodeExecutionEnv({ cwd });
  const repo = new SqliteSessionRepo({
    env,
    sqlite: createNodeSqliteFactory(),
    databasePath: join(cwd, "sessions.sqlite"),
  });
  return { cwd, env, repo };
}

describe("Pi 0.82.1 public API compatibility", () => {
  it("meets the runtime Node baseline and freezes provider mapping", () => {
    expect(() => assertSupportedNodeVersion()).not.toThrow();
    expect(toRuntimeProviderId("anthropic")).toBe("anthropic");
    expect(toRuntimeProviderId("openai_compatible")).toBe("openai-compatible");
  });

  it("creates, reopens, lists and deletes a caller-owned SQLite session id", async () => {
    const { cwd, env, repo } = await createRepo();
    const sessionId = crypto.randomUUID();

    try {
      const session = await repo.create({ id: sessionId, cwd });
      expect((await session.getMetadata()).id).toBe(sessionId);

      await session.appendCustomEntry("glaux.command.accepted", {
        command_id: crypto.randomUUID(),
        digest: "sha256:test",
      });

      const metadata = (await repo.list()).find((item) => item.id === sessionId);
      expect(metadata).toBeDefined();

      const reopened = await repo.open(metadata!);
      expect((await reopened.getEntries()).some((entry) => entry.type === "custom")).toBe(true);

      await repo.delete(metadata!);
      expect((await repo.list()).some((item) => item.id === sessionId)).toBe(false);
    } finally {
      await env.cleanup();
    }
  });

  it("runs AgentHarness prompt and exposes the SDD event surface", async () => {
    const { cwd, env, repo } = await createRepo();

    try {
      const session = await repo.create({ id: crypto.randomUUID(), cwd });
      const faux = fauxProvider({ tokensPerSecond: 0 });
      faux.setResponses([fauxAssistantMessage("hello from pi")]);
      const models = createModels();
      models.setProvider(faux.provider);
      const harness = new AgentHarness({
        session,
        models,
        model: faux.getModel(),
        systemPrompt: "You are the Glaux reference agent.",
      });
      const events: AgentHarnessEvent[] = [];
      const unsubscribe = harness.subscribe((event) => {
        events.push(event);
      });

      const answer = await harness.prompt("hello");
      await harness.waitForIdle();
      unsubscribe();

      expect(answer.role).toBe("assistant");
      const eventTypes = new Set(events.map((event) => event.type));
      for (const required of REQUIRED_AGENT_EVENT_TYPES.slice(0, 7)) {
        expect(eventTypes.has(required), `missing ${required}`).toBe(true);
      }
      expect(faux.state.callCount).toBe(1);
    } finally {
      await env.cleanup();
    }
  });

  it("keeps unprojected custom entries out of model context", async () => {
    const { cwd, env, repo } = await createRepo();

    try {
      const session = await repo.create({ id: crypto.randomUUID(), cwd });
      await session.appendCustomEntry("glaux.command.accepted", {
        command_id: crypto.randomUUID(),
        digest: "sha256:test",
      });
      const context = await session.buildContext();

      expect(context.messages).toEqual([]);
      expect(estimateContextTokens(context.messages).tokens).toBe(0);
      expect(shouldCompact(0, 128_000, DEFAULT_COMPACTION_SETTINGS)).toBe(false);
    } finally {
      await env.cleanup();
    }
  });

  it("exposes abort, compaction and tree navigation methods without private access", () => {
    expect(typeof AgentHarness.prototype.abort).toBe("function");
    expect(typeof AgentHarness.prototype.compact).toBe("function");
    expect(typeof AgentHarness.prototype.navigateTree).toBe("function");
  });
});
