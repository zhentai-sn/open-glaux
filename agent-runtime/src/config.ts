import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertSupportedNodeVersion } from "./pi/compatibility.js";

export interface RuntimeConfig {
  host: "127.0.0.1" | "0.0.0.0";
  port: number;
  dataDir: string;
  workspaceDir: string;
  piDatabasePath: string;
  metaDatabasePath: string;
}

function parsePort(value: string | undefined): number {
  const port = value === undefined ? 8010 : Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`GLAUX_AGENT_PORT must be an integer between 1 and 65535; received ${value}`);
  }
  return port;
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  assertSupportedNodeVersion();
  const host = env.GLAUX_AGENT_HOST ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "0.0.0.0") throw new Error("Invalid GLAUX_AGENT_HOST");

  const workspaceDir = fileURLToPath(new URL("../../", import.meta.url));
  const dataDir = resolve(env.GLAUX_AGENT_DATA_DIR ?? resolve(workspaceDir, ".glaux/agent"));
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });

  return {
    host,
    port: parsePort(env.GLAUX_AGENT_PORT),
    dataDir,
    workspaceDir,
    piDatabasePath: resolve(dataDir, "pi-sessions.sqlite"),
    metaDatabasePath: resolve(dataDir, "glaux-meta.sqlite"),
  };
}
