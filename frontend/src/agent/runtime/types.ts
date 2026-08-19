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
  /**
   * 模型是否按视觉模型对待。必须显式传：pi-ai 在模型 `input` 不含 `"image"` 时
   * 会把用户消息里的图静默换成"(image omitted)"文本占位，不报错——表现为"读不懂图"。
   */
  vision?: boolean;
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
  /** 上游自报的上下文窗口 / 最大输出；探不到即缺省，前端回退默认值（SDD 00 §4）。 */
  context_window?: number;
  max_tokens?: number;
}

export interface ConnectionModelListResult {
  models: ConnectionModelInfo[];
  reason?: string;
}

// --- 图谱描述生成（/agent-api/v1/atlas/describe，SDD feats/03 §5.2 / §7.6）------------------

export interface AtlasDescribeInput {
  image_base64: string;
  mime_type?: string;
  hint?: string;
  connection: ConnectionInput;
}

export interface AtlasDescribeResult {
  description: {
    modality: string;
    subject: string;
    findings: { name: string; location?: string; appearance?: string }[];
    pattern: string;
    summary: string;
    extra: Record<string, unknown>;
  };
  statement_version: string;
}

// --- 会话事件 atlas.referenced 的 payload（SDD feats/03 §12；由 02 locate_roi 产出）------------

export interface AtlasReferencedPayload {
  trace_id: string;
  candidate_ids: string[];
  selected_ids: string[];
  excluded_by_egress: number;
  snapshots: { exemplar_id: string; caption: string; tags: string[] }[];
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

/** 用户消息内联图像附件（SDD 00 §4.3 / D-021）；`data` 为不带 `data:` 前缀的 base64。 */
export interface PromptImage {
  data: string;
  mime_type: string;
}

export type TransportCommand =
  | {
      command_id: string;
      type: "prompt";
      content: string;
      images?: PromptImage[];
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
