import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import {
  TEST_CONNECTION,
  createRuntimeFixture,
  waitFor,
} from "../helpers/runtime-fixture.js";

describe("idempotent harness commands", () => {
  it("persists one prompt and one model call across settled retries", async () => {
    const fixture = await createRuntimeFixture([
      [fauxAssistantMessage("first answer")],
    ]);
    const sessionId = crypto.randomUUID();
    const commandId = crypto.randomUUID();

    try {
      await fixture.sessions.createSession({ session_id: sessionId });
      const command = {
        command_id: commandId,
        type: "prompt" as const,
        content: "hello",
        connection: TEST_CONNECTION,
      };
      await fixture.commands.accept(sessionId, command);
      await fixture.registry.waitForIdle(sessionId);
      await waitFor(async () => {
        const session = await fixture.sessions.openSession(sessionId);
        try {
          return (await session.getEntries()).some(
            (entry) =>
              entry.type === "custom" &&
              entry.customType === "glaux.command.settled",
          );
        } finally {
          await fixture.sessions.closeSession(session);
        }
      });

      await fixture.commands.accept(sessionId, command);
      const view = await fixture.sessions.getSession(sessionId);
      expect(view.messages.filter((message) => message.role === "user")).toHaveLength(1);
      expect(fixture.handles[0]?.state.callCount).toBe(1);
      expect(view.title).toBe("hello");

      await expect(
        fixture.commands.accept(sessionId, { ...command, content: "different" }),
      ).rejects.toMatchObject({ code: "idempotency_conflict" });
    } finally {
      await fixture.close();
    }
  });

  it("rejects a second command while the same session is running", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fixture = await createRuntimeFixture([
      [
        async () => {
          await gate;
          return fauxAssistantMessage("finished");
        },
      ],
    ]);
    const sessionId = crypto.randomUUID();

    try {
      await fixture.sessions.createSession({ session_id: sessionId });
      await fixture.commands.accept(sessionId, {
        command_id: crypto.randomUUID(),
        type: "prompt",
        content: "first",
        connection: TEST_CONNECTION,
      });
      await expect(
        fixture.commands.accept(sessionId, {
          command_id: crypto.randomUUID(),
          type: "prompt",
          content: "second",
          connection: TEST_CONNECTION,
        }),
      ).rejects.toMatchObject({ code: "session_busy" });
      release();
      await fixture.registry.waitForIdle(sessionId);
    } finally {
      release();
      await fixture.close();
    }
  });

  it("runs different sessions concurrently", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fixture = await createRuntimeFixture([
      [async () => (await gate, fauxAssistantMessage("one"))],
      [async () => (await gate, fauxAssistantMessage("two"))],
    ]);
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();

    try {
      await fixture.sessions.createSession({ session_id: first });
      const firstSession = await fixture.sessions.openSession(first);
      await firstSession.appendMessage({
        role: "user",
        content: "seed",
        timestamp: Date.now(),
      });
      await fixture.sessions.closeSession(firstSession);
      await fixture.sessions.createSession({ session_id: second });
      await fixture.commands.accept(first, {
        command_id: crypto.randomUUID(),
        type: "prompt",
        content: "one",
        connection: TEST_CONNECTION,
      });
      await fixture.commands.accept(second, {
        command_id: crypto.randomUUID(),
        type: "prompt",
        content: "two",
        connection: TEST_CONNECTION,
      });
      expect(fixture.registry.getPhase(first)).toBe("running");
      expect(fixture.registry.getPhase(second)).toBe("running");
      release();
      await Promise.all([
        fixture.registry.waitForIdle(first),
        fixture.registry.waitForIdle(second),
      ]);
    } finally {
      release();
      await fixture.close();
    }
  });
});
