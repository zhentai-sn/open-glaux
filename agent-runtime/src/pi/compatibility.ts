import type { AgentHarnessEvent } from "@earendil-works/pi-agent-core";

export const PI_VERSION = "0.82.1" as const;

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

export type FrontendProviderId = "anthropic" | "openai_compatible";
export type RuntimeProviderId = "anthropic" | "openai-compatible";

export function toRuntimeProviderId(provider: FrontendProviderId): RuntimeProviderId {
  return provider === "openai_compatible" ? "openai-compatible" : "anthropic";
}

export function assertSupportedNodeVersion(version = process.versions.node): void {
  const [major = 0, minor = 0] = version.split(".").map((part) => Number.parseInt(part, 10));
  if (major < 22 || (major === 22 && minor < 19)) {
    throw new Error(`Pi 0.82.1 requires Node >=22.19.0; current ${version}`);
  }
}
