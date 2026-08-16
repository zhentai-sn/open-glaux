import type { AgentHarnessEvent } from "@earendil-works/pi-agent-core";

export const REQUIRED_AGENT_EVENT_TYPES = [
  "agent_start",
  "turn_start",
  "message_start",
  "message_update",
  "message_end",
  "turn_end",
  "agent_end",
  "session_before_compact",
  "session_compact",
] as const satisfies readonly AgentHarnessEvent["type"][];

/** 前端历史枚举（下划线）与 runtime 枚举（连字符）——单一映射点，routes / probe 都用它。 */
export type FrontendProviderId = "anthropic" | "openai_compatible";
export type RuntimeProviderId = "anthropic" | "openai-compatible";

export function toRuntimeProviderId(provider: FrontendProviderId): RuntimeProviderId {
  return provider === "openai_compatible" ? "openai-compatible" : "anthropic";
}

/** 任意输入 → runtime provider id；两种拼法都接受，其它返回 null（由调用方报 400）。 */
export function parseProviderId(value: unknown): RuntimeProviderId | null {
  if (value === "anthropic" || value === "openai-compatible") return value;
  if (value === "openai_compatible") return toRuntimeProviderId(value);
  return null;
}

export function assertSupportedNodeVersion(version = process.versions.node): void {
  const [major = 0, minor = 0] = version.split(".").map((part) => Number.parseInt(part, 10));
  if (major < 22 || (major === 22 && minor < 19)) {
    throw new Error(`Pi 0.82.1 requires Node >=22.19.0; current ${version}`);
  }
}
