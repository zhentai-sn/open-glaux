import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import type { TransportEvent } from "../../src/contracts.js";
import {
  TEST_CONNECTION,
  createRuntimeFixture,
} from "../helpers/runtime-fixture.js";

describe("multi-session streaming and recovery", () => {
  it("keeps concurrent event streams isolated and reconnects snapshot-first", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fixture = await createRuntimeFixture([
      [async () => (await gate, fauxAssistantMessage("first answer"))],
      [async () => (await gate, fauxAssistantMessage("second answer"))],
    ]);
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();
    const firstEvents: TransportEvent[] = [];
    const secondEvents: TransportEvent[] = [];

    try {
      await fixture.sessions.createSession({ session_id: first });
      const seeded = await fixture.sessions.openSession(first);
      await seeded.appendMessage({
        role: "user",
        content: "seed",
        timestamp: Date.now(),
      });
      await fixture.sessions.closeSession(seeded);
      await fixture.sessions.createSession({ session_id: second });
      const disconnectFirst = await fixture.broker.connect(
        first,
        () => fixture.sessions.getSession(first),
        (event) => {
          firstEvents.push(event);
        },
      );
      const disconnectSecond = await fixture.broker.connect(
        second,
        () => fixture.sessions.getSession(second),
        (event) => {
          secondEvents.push(event);
        },
      );

      await Promise.all([
        fixture.commands.accept(first, {
          command_id: crypto.randomUUID(),
          type: "prompt",
          content: "one",
          connection: TEST_CONNECTION,
        }),
        fixture.commands.accept(second, {
          command_id: crypto.randomUUID(),
          type: "prompt",
          content: "two",
          connection: TEST_CONNECTION,
        }),
      ]);
      expect(fixture.registry.getPhase(first)).toBe("running");
      expect(fixture.registry.getPhase(second)).toBe("running");

      release();
      await Promise.all([
        fixture.registry.waitForIdle(first),
        fixture.registry.waitForIdle(second),
      ]);

      const firstPiEvents = firstEvents.filter(
        (event) => event.event === "pi.event",
      );
      const secondPiEvents = secondEvents.filter(
        (event) => event.event === "pi.event",
      );
      expect(firstPiEvents.length).toBeGreaterThan(0);
      expect(secondPiEvents.length).toBeGreaterThan(0);
      expect(
        firstPiEvents.every(
          (event) =>
            event.event === "pi.event" && event.data.session_id === first,
        ),
      ).toBe(true);
      expect(
        secondPiEvents.every(
          (event) =>
            event.event === "pi.event" && event.data.session_id === second,
        ),
      ).toBe(true);

      disconnectFirst();
      disconnectSecond();
      const reconnected: TransportEvent[] = [];
      const disconnectReconnect = await fixture.broker.connect(
        first,
        () => fixture.sessions.getSession(first),
        (event) => {
          reconnected.push(event);
        },
      );
      expect(reconnected[0]?.event).toBe("snapshot");
      const firstSnapshot =
        reconnected[0]?.event === "snapshot" ? reconnected[0].data : undefined;
      const secondSnapshot = await fixture.sessions.getSession(second);
      const assistantTexts = [firstSnapshot, secondSnapshot].flatMap(
        (snapshot) =>
          snapshot?.messages
            .filter((message) => message.role === "assistant")
            .map((message) => JSON.stringify(message.content)) ?? [],
      );
      expect(firstSnapshot?.session_id).toBe(first);
      expect(secondSnapshot.session_id).toBe(second);
      expect(assistantTexts).toHaveLength(2);
      expect(assistantTexts.some((text) => text.includes("first answer"))).toBe(
        true,
      );
      disconnectReconnect();
    } finally {
      release();
      await fixture.close();
    }
  });

  it("aborts a streaming response within one second", async () => {
    const fixture = await createRuntimeFixture(
      [[fauxAssistantMessage("stream ".repeat(200))]],
      { tokensPerSecond: 25 },
    );
    const sessionId = crypto.randomUUID();

    try {
      await fixture.sessions.createSession({ session_id: sessionId });
      await fixture.commands.accept(sessionId, {
        command_id: crypto.randomUUID(),
        type: "prompt",
        content: "start",
        connection: TEST_CONNECTION,
      });
      const startedAt = performance.now();
      await fixture.commands.accept(sessionId, {
        command_id: crypto.randomUUID(),
        type: "abort",
      });
      expect(performance.now() - startedAt).toBeLessThan(1000);
      expect(fixture.registry.getPhase(sessionId)).toBe("idle");
    } finally {
      await fixture.close();
    }
  });
});
