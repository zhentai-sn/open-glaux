import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { CommandService } from "../../src/pi/command-service.js";
import { HarnessRegistry } from "../../src/pi/harness-registry.js";
import { SessionService } from "../../src/pi/session-service.js";
import { TEST_CONNECTION } from "../helpers/runtime-fixture.js";

describe("Runtime restart recovery", () => {
  it("reopens committed Pi state and refuses to replay an unsettled command", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "glaux-restart-"));
    const options = {
      workspaceDir: dataDir,
      piDatabasePath: join(dataDir, "pi-sessions.sqlite"),
      metaDatabasePath: join(dataDir, "glaux-meta.sqlite"),
    };
    const sessionId = crypto.randomUUID();
    const commandId = crypto.randomUUID();
    const content = "resume after restart";
    const digest = createHash("sha256")
      .update(JSON.stringify({ type: "prompt", content }))
      .digest("hex");

    const first = new SessionService(options);
    await first.initialize();
    await first.createSession({ session_id: sessionId });
    const session = await first.openSession(sessionId);
    await session.appendMessage({
      role: "user",
      content: "committed before interruption",
      timestamp: Date.now(),
    });
    await session.appendModelChange("openai-compatible", "fixture-model");
    await session.appendCustomEntry("glaux.command.accepted", {
      command_id: commandId,
      command_type: "prompt",
      digest,
    });
    await first.closeSession(session);
    await first.patchSession(sessionId, {
      title: "Recovered",
      permission_mode: "suggest",
      status: "archived",
    });
    await first.close();

    const restarted = new SessionService(options);
    let registry: HarnessRegistry | undefined;
    registry = new HarnessRegistry(restarted, () => {
      const faux = fauxProvider({
        models: [
          {
            id: "fixture-model",
            contextWindow: 128_000,
            maxTokens: 4096,
          },
        ],
      });
      faux.setResponses([fauxAssistantMessage("must not be called")]);
      const models = createModels();
      models.setProvider(faux.provider);
      return {
        models,
        model: faux.getModel(),
        disposeCredential() {},
      };
    });
    const commands = new CommandService(restarted, registry);

    try {
      await restarted.initialize();
      const recovered = await restarted.getSession(sessionId);
      expect(recovered).toMatchObject({
        title: "Recovered",
        status: "archived",
        permission_mode: "suggest",
        provider: "openai-compatible",
        model: "fixture-model",
        phase: "idle",
      });
      expect(recovered.messages).toEqual([
        expect.objectContaining({
          role: "user",
          content: "committed before interruption",
        }),
      ]);

      await restarted.patchSession(sessionId, { status: "active" });
      await expect(
        commands.accept(sessionId, {
          command_id: commandId,
          type: "prompt",
          content,
          connection: TEST_CONNECTION,
        }),
      ).rejects.toMatchObject({
        code: "command_outcome_unknown",
        statusCode: 409,
      });
      expect(registry.getPhase(sessionId)).toBe("idle");
    } finally {
      await registry.close();
      await restarted.close();
    }
  });
});
