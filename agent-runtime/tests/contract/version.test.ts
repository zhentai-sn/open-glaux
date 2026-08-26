import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { RUNTIME_VERSION, readPackageVersion } from "../../src/version.js";

describe("Agent Runtime version", () => {
  it("comes from the component package metadata", () => {
    const packageUrl = new URL("../../package.json", import.meta.url);
    const metadata = JSON.parse(readFileSync(packageUrl, "utf8")) as { version: string };

    expect(readPackageVersion(packageUrl)).toBe(metadata.version);
    expect(RUNTIME_VERSION).toBe(metadata.version);
  });

  it("fails explicitly when package metadata is unavailable", () => {
    const missing = new URL("./missing-package.json", import.meta.url);
    expect(() => readPackageVersion(missing)).toThrow(/Unable to read Agent Runtime version/);
  });
});
