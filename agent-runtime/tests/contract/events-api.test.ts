import { describe, expect, it } from "vitest";

import { RuntimeError } from "../../src/errors.js";
import {
  createRuntimeFixture,
} from "../helpers/runtime-fixture.js";

describe("snapshot-first event transport", () => {
  it("buffers registry events until the snapshot has been sent", async () => {
    const fixture = await createRuntimeFixture();
    const sessionId = crypto.randomUUID();
    let releaseSnapshot!: () => void;
    const snapshotGate = new Promise<void>((resolve) => {
      releaseSnapshot = resolve;
    });
    const delivered: string[] = [];

    try {
      await fixture.sessions.createSession({ session_id: sessionId });
      const connecting = fixture.broker.connect(
        sessionId,
        async () => {
          await snapshotGate;
          return fixture.sessions.getSession(sessionId);
        },
        (event) => {
          delivered.push(event.event);
        },
      );
      await Promise.resolve();
      fixture.registry.emitAdapterError(
        sessionId,
        undefined,
        new RuntimeError("provider_unreachable", "offline", 503),
      );
      releaseSnapshot();
      const disconnect = await connecting;

      expect(delivered).toEqual(["snapshot", "adapter.error"]);
      disconnect();
    } finally {
      releaseSnapshot();
      await fixture.close();
    }
  });
});
