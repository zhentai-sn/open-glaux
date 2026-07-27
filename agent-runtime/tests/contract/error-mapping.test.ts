import { describe, expect, it } from "vitest";

import { buildServer } from "../../src/transport/server.js";

describe("safe HTTP errors", () => {
  it("does not expose stack or credentials", async () => {
    const server = buildServer();
    try {
      const response = await server.inject({
        method: "GET",
        url: "/agent-api/v1/not-found?credential=secret-value",
      });
      const body = response.body;
      expect(response.statusCode).toBe(404);
      expect(body).not.toContain("secret-value");
      expect(body.toLowerCase()).not.toContain("stack");
    } finally {
      await server.close();
    }
  });
});
