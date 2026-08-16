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

// --- 连接探测（/agent-api/v1/connection/*）——镜像 agent-runtime connection-probe -----------

export interface ConnectionProbeInput {
  provider: ConnectionInput["provider"];
  base_url?: string;
  credential?: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  http_status: number | null;
  reason: string;
  model_count?: number;
}

export interface ConnectionModelInfo {
  id: string;
  vision: "yes" | "no" | "unknown";
}

export interface ConnectionModelListResult {
  models: ConnectionModelInfo[];
  reason?: string;
}

/** 查看器当前上下文——随 prompt 下发，供 agent-runtime 的 `run_task` 工具缺省取当前图 / 当前任务。 */
export interface ViewerContext {
  image_id?: string;
  task?: string;
  modality?: string;
  method?: string;
  cubs_cf?: number;
  roi_box?: [number, number, number, number];
}

export type TransportCommand =
  | {
      command_id: string;
      type: "prompt";
      content: string;
      connection: ConnectionInput;
      viewer?: ViewerContext;
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
