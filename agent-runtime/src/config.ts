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
  /** 生产运行模式：前端构建产物目录（`GLAUX_SERVE_STATIC`，SDD 24 §7.1）。 */
  staticDir?: string;
  /** 生产运行模式的会话令牌（`GLAUX_SESSION_TOKEN`，SDD 24 §7.2）。 */
  sessionToken?: string;
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

  const staticDir = env.GLAUX_SERVE_STATIC?.trim() ? resolve(env.GLAUX_SERVE_STATIC.trim()) : undefined;
  const sessionToken = env.GLAUX_SESSION_TOKEN?.trim() || undefined;
  if ((staticDir || sessionToken) && host !== "127.0.0.1") {
    throw new Error("GLAUX_SERVE_STATIC and GLAUX_SESSION_TOKEN require GLAUX_AGENT_HOST=127.0.0.1");
  }

  return {
    host,
    port: parsePort(env.GLAUX_AGENT_PORT),
    ...(staticDir ? { staticDir } : {}),
    ...(sessionToken ? { sessionToken } : {}),
    dataDir,
    workspaceDir,
    piDatabasePath: resolve(dataDir, "pi-sessions.sqlite"),
    metaDatabasePath: resolve(dataDir, "glaux-meta.sqlite"),
  };
}
