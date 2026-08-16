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
  context_window?: number;
  max_tokens?: number;
  credential?: string;
}

/**
 * 前端查看器当前上下文——随 prompt 命令下发，供领域工具（`run_task`）默认取"当前打开的图 / 当前任务"。
 * SDD 02 §4.2「当前影像上下文由前端随会话上下文提供」的首次接线；字段全部可选。
 */
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

export interface SafeErrorBody {
  error: {
    code: string;
    message: string;
    trace_id: string;
  };
}

export type TransportEvent =
  | {
      event: "snapshot";
      data: SessionView;
    }
  | {
      event: "pi.event";
      data: {
        session_id: string;
        command_id?: string;
        event: import("@earendil-works/pi-agent-core").AgentHarnessEvent;
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
