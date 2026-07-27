import { afterEach, describe, expect, it } from "vitest";

import { buildServer } from "../../src/transport/server.js";
import {
  createRuntimeFixture,
} from "../helpers/runtime-fixture.js";

describe("session REST contract", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("implements create/list/get/patch/delete with client UUID idempotency", async () => {
    const fixture = await createRuntimeFixture();
    const server = buildServer({
      routes: {
        sessions: fixture.sessions,
        commands: fixture.commands,
        registry: fixture.registry,
        broker: fixture.broker,
      },
    });
    cleanups.push(async () => {
      await server.close();
      await fixture.close();
    });
    const sessionId = crypto.randomUUID();

    const created = await server.inject({
      method: "POST",
      url: "/agent-api/v1/sessions",
      payload: { session_id: sessionId, title: "API session" },
    });
    expect(created.statusCode).toBe(201);
    const repeated = await server.inject({
      method: "POST",
      url: "/agent-api/v1/sessions",
      payload: { session_id: sessionId, title: "API session" },
    });
    expect(repeated.statusCode).toBe(200);

    const list = await server.inject({
      method: "GET",
      url: "/agent-api/v1/sessions?status=active",
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);

    const patched = await server.inject({
      method: "PATCH",
      url: `/agent-api/v1/sessions/${sessionId}`,
      payload: { title: "Renamed", permission_mode: "suggest" },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({
      title: "Renamed",
      permission_mode: "suggest",
    });

    const deleted = await server.inject({
      method: "DELETE",
      url: `/agent-api/v1/sessions/${sessionId}`,
    });
    expect(deleted.statusCode).toBe(204);
    expect(
      (
        await server.inject({
          method: "GET",
          url: `/agent-api/v1/sessions/${sessionId}`,
        })
      ).statusCode,
    ).toBe(404);
  });

  it("requires explicit metadata for a custom model", async () => {
    const fixture = await createRuntimeFixture();
    const server = buildServer({
      routes: {
        sessions: fixture.sessions,
        commands: fixture.commands,
        registry: fixture.registry,
        broker: fixture.broker,
      },
    });
    cleanups.push(async () => {
      await server.close();
      await fixture.close();
    });
    const sessionId = crypto.randomUUID();
    await fixture.sessions.createSession({ session_id: sessionId });

    const response = await server.inject({
      method: "POST",
      url: `/agent-api/v1/sessions/${sessionId}/commands`,
      payload: {
        command_id: crypto.randomUUID(),
        type: "prompt",
        content: "hello",
        connection: {
          provider: "openai-compatible",
          model: "custom",
          base_url: "http://127.0.0.1:1234/v1",
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("model_metadata_required");
  });
});
