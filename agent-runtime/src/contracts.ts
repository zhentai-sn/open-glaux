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
  /**
   * 模型是否具备视觉输入（前端由 /connection/models 的 vision 判定填入；Atlas describe 恒为 true）。
   * 只影响 pi-ai 对**工具结果**中图像块的转换（用户消息中的图像块无条件转换）。
   */
  vision?: boolean;
}

/**
 * SDD 03 §12：agent 在一次 `locate_roi` 中查阅了图谱。由 runtime 侧 `selectExemplars()` 构造，
 * 经现有 `pi.event` 通道下发；前端渲染为"参考图谱 N 条"卡片（AtlasRefCard）。
 */
export interface AtlasReferencedPayload {
  trace_id: string;
  /** 检索命中的候选（≤ 10） */
  candidate_ids: string[];
  /** VLM 从候选中挑出的 1–3 条（候选 ≤ 3 时等于候选） */
  selected_ids: string[];
  /** 因外发限制（local-only）被检索层排除的条数——backend 已过滤，此处由 runtime 用 `egress=any` 对比得出 */
  excluded_by_egress: number;
  /** 供卡片降级展示的快照（案例被下架/删除后仍可显示） */
  snapshots: { exemplar_id: string; caption: string; tags: string[] }[];
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
