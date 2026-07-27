import { describe, expect, it } from "vitest";

import { REDACTED, redact, redactText } from "../../src/security/redact.js";

describe("credential redaction", () => {
  it("redacts nested sensitive fields without mutating the input", () => {
    const input = {
      connection: {
        credential: "glaux-secret-key",
        nested: [{ api_key: "another-secret" }],
      },
      safe: "visible",
    };

    expect(redact(input)).toEqual({
      connection: {
        credential: REDACTED,
        nested: [{ api_key: REDACTED }],
      },
      safe: "visible",
    });
    expect(input.connection.credential).toBe("glaux-secret-key");
  });

  it("redacts bearer and key-like text", () => {
    expect(redactText("Authorization: Bearer abc-123")).not.toContain("abc-123");
    expect(redactText("api_key=secret-value")).not.toContain("secret-value");
  });
});
