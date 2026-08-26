import { readFileSync } from "node:fs";

const PACKAGE_JSON_URL = new URL("../package.json", import.meta.url);

export function readPackageVersion(source = PACKAGE_JSON_URL): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(source, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read Agent Runtime version from ${source.pathname}: ${reason}`);
  }

  const version =
    typeof parsed === "object" && parsed !== null && "version" in parsed
      ? (parsed as { version?: unknown }).version
      : undefined;
  if (typeof version !== "string" || version.trim() === "") {
    throw new Error(`Agent Runtime package metadata has no non-empty version: ${source.pathname}`);
  }
  return version;
}

export const RUNTIME_VERSION = readPackageVersion();
