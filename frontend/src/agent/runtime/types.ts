export type SessionStatus = "active" | "archived";
export type PermissionMode = "observe" | "suggest" | "controlled" | "autonomous";
export type SessionPhase = "idle" | "running" | "stopping" | "compacting" | "error";

export interface ContextUsage {
  tokens: number;
  context_window?: number;
  ratio?: number;
}

export interface SessionView {
  session_id: string;
  title: string;
  status: SessionStatus;
  permission_mode: PermissionMode;
  provider: string | null;
  model: string | null;
  phase: SessionPhase;
  messages: unknown[];
  context_usage: ContextUsage | null;
  created_at: string;
  updated_at: string;
}

export type SessionListItem = Omit<SessionView, "messages">;

export interface ConnectionInput {
  provider: "anthropic" | "openai-compatible";
  model: string;
  base_url?: string;
  context_window?: number;
  max_tokens?: number;
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

export type TransportEvent =
  | { event: "snapshot"; data: SessionView }
  | {
      event: "pi.event";
      data: {
        session_id: string;
        command_id?: string;
        event: unknown;
      };
    }
  | {
      event: "adapter.error";
      data: {
        session_id: string;
        command_id?: string;
        code: string;
        message: string;
        trace_id: string;
      };
    };

export interface RuntimeHealth {
  status: "ok";
  adapter: "ok";
  pi: "ok";
  storage: "ok";
  version?: string;
}
