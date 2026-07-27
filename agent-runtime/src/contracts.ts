import type { AgentMessage } from "@earendil-works/pi-agent-core";

export const SESSION_STATUSES = ["active", "archived"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const PERMISSION_MODES = [
  "observe",
  "suggest",
  "controlled",
  "autonomous",
] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

export type SessionPhase = "idle" | "running" | "stopping" | "compacting" | "error";

export interface GlauxSessionMeta {
  session_id: string;
  title: string;
  status: SessionStatus;
  permission_mode: PermissionMode;
  created_at: string;
  updated_at: string;
}

export interface ContextUsage {
  tokens: number;
  context_window?: number;
  ratio?: number;
}

export interface SessionView extends GlauxSessionMeta {
  provider: string | null;
  model: string | null;
  phase: SessionPhase;
  messages: AgentMessage[];
  context_usage: ContextUsage | null;
}

export type SessionListItem = Omit<SessionView, "messages">;

export interface CreateSessionInput {
  session_id: string;
  title?: string;
  permission_mode?: PermissionMode;
}

export interface PatchSessionInput {
  title?: string;
  status?: SessionStatus;
  permission_mode?: PermissionMode;
  provider?: string;
  model?: string;
}

export interface ConnectionInput {
  provider: string;
  model: string;
  base_url?: string;
  credential?: string;
}

export type TransportCommand =
  | {
      command_id: string;
      type: "prompt";
      content: string;
      connection: ConnectionInput;
    }
  | {
      command_id: string;
      type: "regenerate";
      connection: ConnectionInput;
    }
  | {
      command_id: string;
      type: "abort";
    };

export interface SafeErrorBody {
  error: {
    code: string;
    message: string;
    trace_id: string;
  };
}
