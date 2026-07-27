import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { redact } from "../../src/security/redact.js";
import type { TransportEvent } from "../../src/contracts.js";
import {
  createRuntimeFixture,
  waitFor,
} from "../helpers/runtime-fixture.js";

describe("end-to-end credential boundary", () => {
  it("keeps credentials out of databases, receipts, events, errors and logs", async () => {
    const credential = "glaux-secret-key-credential-scan-9a70";
    const authorization = `Bearer ${credential}`;
    const fixture = await createRuntimeFixture([
      [fauxAssistantMessage("safe answer")],
    ]);
    const sessionId = crypto.randomUUID();
    const events: TransportEvent[] = [];

    try {
      await fixture.sessions.createSession({ session_id: sessionId });
      const disconnect = await fixture.broker.connect(
        sessionId,
        () => fixture.sessions.getSession(sessionId),
        (event) => {
          events.push(event);
        },
      );
      await fixture.commands.accept(sessionId, {
        command_id: crypto.randomUUID(),
        type: "prompt",
        content: "safe prompt",
        connection: {
          provider: "openai-compatible",
          model: "fixture-model",
          base_url: "http://127.0.0.1:1234/v1",
          context_window: 128_000,
          max_tokens: 4096,
          credential,
        },
      });
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

      const session = await fixture.sessions.openSession(sessionId);
      const entries = await session.getEntries();
      await fixture.sessions.closeSession(session);
      const captured = JSON.stringify({
        events,
        entries,
        view: await fixture.sessions.getSession(sessionId),
        log: redact({
          credential,
          authorization,
          nested: { api_key: credential, cookie: authorization },
        }),
      });
      expect(captured).not.toContain(credential);
      expect(captured).not.toContain(authorization);
      disconnect();
    } finally {
      await fixture.close();
    }

    for (const file of await readdir(fixture.dataDir)) {
      const path = join(fixture.dataDir, file);
      const bytes = await readFile(path);
      expect(bytes.includes(Buffer.from(credential)), path).toBe(false);
      expect(bytes.includes(Buffer.from(authorization)), path).toBe(false);
    }
  });
});
