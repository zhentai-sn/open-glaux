import { describe, expect, it } from "vitest";

import { REDACTED, redact, redactStrings, redactText } from "../../src/security/redact.js";

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

  it("redacts strings inside structures without breaking them", () => {
    const input = { args: { header: "Authorization: Bearer abc-123" }, tokens: 5 };
    const out = redactStrings(input);
    expect(JSON.stringify(out)).not.toContain("abc-123");
    expect(out.tokens).toBe(5);
    expect(input.args.header).toContain("abc-123");
  });
});
