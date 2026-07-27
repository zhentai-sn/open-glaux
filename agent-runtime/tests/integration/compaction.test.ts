import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import {
  TEST_CONNECTION,
  createRuntimeFixture,
} from "../helpers/runtime-fixture.js";

describe("Pi default compaction", () => {
  it("compacts long context before prompting and persists the entry", async () => {
    const fixture = await createRuntimeFixture(
      [[fauxAssistantMessage("summary"), fauxAssistantMessage("after compact")]],
      { contextWindow: 40_000 },
    );
    const sessionId = crypto.randomUUID();
    const events: string[] = [];

    try {
      await fixture.sessions.createSession({ session_id: sessionId });
      const session = await fixture.sessions.openSession(sessionId);
      for (let index = 0; index < 12; index += 1) {
        await session.appendMessage({
          role: "user",
          content: `${index}:${"x".repeat(12_000)}`,
          timestamp: Date.now(),
        });
        await session.appendMessage({
          ...fauxAssistantMessage(`answer-${index}`),
          usage: {
            input: (index + 1) * 3000,
            output: 100,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: (index + 1) * 3000 + 100,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
        });
      }
      await fixture.sessions.closeSession(session);
      const unsubscribe = fixture.registry.subscribe(sessionId, (event) => {
        if (event.event === "pi.event") events.push(event.data.event.type);
      });

      await fixture.commands.accept(sessionId, {
        command_id: crypto.randomUUID(),
        type: "prompt",
        content: "continue",
        connection: { ...TEST_CONNECTION, context_window: 40_000 },
      });
      await fixture.registry.waitForIdle(sessionId);
      unsubscribe();

      const reopened = await fixture.sessions.openSession(sessionId);
      try {
        expect(
          (await reopened.getEntries()).some((entry) => entry.type === "compaction"),
        ).toBe(true);
      } finally {
        await fixture.sessions.closeSession(reopened);
      }
      expect(events).toContain("session_compact");
    } finally {
      await fixture.close();
    }
  });
});
