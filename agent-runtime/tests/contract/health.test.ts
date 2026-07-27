import { afterEach, describe, expect, it } from "vitest";

import { buildServer } from "../../src/transport/server.js";

describe("GET /agent-api/v1/health", () => {
  const servers: ReturnType<typeof buildServer>[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it("reports adapter, Pi and storage readiness", async () => {
    const server = buildServer({
      healthCheck: async () => ({ version: "test" }),
    });
    servers.push(server);

    const response = await server.inject({
      method: "GET",
      url: "/agent-api/v1/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      adapter: "ok",
      pi: "ok",
      storage: "ok",
      version: "test",
    });
  });
});
