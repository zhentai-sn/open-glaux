import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { HarnessTool, HarnessToolContext } from "./pi/harness-registry.js";

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
  /**
   * 会话绑定的项目（SDD 13 §7.6）；来自 Pi 会话 `metadata.glaux_project_id`，`null` 为未归属。
   * 创建时写入、不可改；不进 companion 表（SDD 00 D-018、D-023）。
   */
  project_id: string | null;
}

/** companion 表 `glaux_session_meta` 的一行（SDD 00 §9.1）：不含 Pi 侧持有的 `project_id`。 */
export type GlauxMetaRecord = Omit<GlauxSessionMeta, "project_id">;

export interface ContextUsage {
  tokens: number;
  context_window?: number;
  ratio?: number;
}

/**
 * SDD 15 §9.6：快照与事件中的消息结构，由 Glaux 声明。
 * 字段与 pi-ai 当前消息一致；pi-ai 结构变化时由 runtime 转换，前端不跟着改。
 */
export type TranscriptBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> };

export type TranscriptMessage =
  | { role: "user"; content: string | TranscriptBlock[] }
  | { role: "assistant"; content: TranscriptBlock[] }
  | {
      role: "toolResult";
      toolCallId: string;
      toolName: string;
      content: TranscriptBlock[];
      details?: unknown;
      isError: boolean;
    };

/** SDD 15 §9.3：等待用户回复的交互请求（权限审批或 `ask_user` 提问）。 */
export interface InteractionRequest {
  request_id: string;
  session_id: string;
  command_id: string;
  kind: "permission" | "question";
  created_at: string;
  expires_at: string;
  permission?: {
    tool_call_id: string;
    tool_name: string;
    effect: import("./plugins/types.js").ToolEffect;
    args_summary: string;
    grant_options: ("once" | "session" | "always")[];
  };
  question?: { question: string; options: string[]; allow_free_text: boolean };
  /** 来自子智能体时为其任务概括（SDD 18 §7.4）。 */
  origin?: { subagent: string };
  /** 主对话中与该请求关联的工具调用：被审批的调用、`ask_user` 调用，或子智能体所属的 `agent` 调用（SDD 15 §9.3）。 */
  tool_call_id?: string;
}

/** 设置文件加载告警等非致命问题（SDD 15 §9.7）。 */
export interface RuntimeWarning {
  code: string;
  message: string;
  path?: string;
}

export interface SessionView extends GlauxSessionMeta {
  provider: string | null;
  model: string | null;
  phase: SessionPhase;
  messages: TranscriptMessage[];
  video_answers?: VideoAnswerRecord[];
  video_observations?: ClipObservation[];
  context_usage: ContextUsage | null;
  pending_interactions: InteractionRequest[];
  warnings: RuntimeWarning[];
}

export type SessionListItem = Omit<
  SessionView,
  "messages" | "video_answers" | "video_observations" | "pending_interactions" | "warnings"
>;

/** 命令结局（SDD 00 §11 + SDD 15 §7.8）。 */
export type RunOutcome = "completed" | "aborted" | "failed" | "budget_exceeded";

export interface RunBudgetStats {
  turns: number;
  elapsed_ms: number;
  exhausted: boolean;
}

export interface CreateSessionInput {
  session_id: string;
  title?: string;
  permission_mode?: PermissionMode;
  /** 缺省或 `null` 为未归属；agent-runtime 不校验项目是否已登记（SDD 13 §7.6 规则 5）。 */
  project_id?: string | null;
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
   *
   * 2026-08-20 更正：此前注释称"用户消息中的图像块无条件转换"，与 pi-ai 实际行为不符。
   * `transformMessages` → `downgradeUnsupportedImages` 在 `model.input` 不含 `"image"` 时，
   * 会把**用户消息和工具结果里的图像一并**替换成 `(image omitted: model does not support images)`
   * 文本占位——不报错、不提示。因此凡是要发图的连接都必须显式带上 `vision: true`，
   * 否则模型收到的只是一句"图已省略"，表现为"能对话但读不懂图"。
   */
  vision?: boolean;
  media_adapter?: "qwen-omni";
}

export interface VideoInterval { start_ms: number; end_ms: number }
export interface ClipObservation {
  observation_id: string;
  object_id: string;
  source_sha256: string;
  requested_interval: VideoInterval;
  actual_interval: VideoInterval;
  mime: "video/mp4";
  clip_sha256: string;
  encoding: Record<string, unknown>;
  fps: 0.5 | 2 | 5;
}
export interface EvidenceRef {
  observation_id: string;
  kind: "visual" | "audio" | "av";
  source_interval: VideoInterval;
  frame_time_ms?: number;
  region?: { kind: "box"; x0: number; y0: number; x1: number; y1: number };
}
export interface VideoAnswer {
  object_id: string;
  claims: { text: string; evidence: EvidenceRef[] }[];
  unanswered: string[];
}
export interface VideoAnswerRecord { command_id: string; answer: VideoAnswer }

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

/** SDD 10 §9.1：runtime 对 backend / frontend 的视觉对象契约镜像。 */
export type ObjectKind = "image" | "volume" | "slide" | "video";
export type AxisName = "x" | "y" | "z" | "t" | "level";
export interface Axis { name: AxisName; size: number; spacing?: number | null; unit?: string }
export interface Calibration { kind: string; value: unknown; source: string; provenance?: Record<string, unknown> }
export interface ObjectContext { id: string; kind: ObjectKind; axes: Axis[]; calibration: Calibration | null }
export interface Index { z?: number | null; t?: number | null; level?: number | null }
export type Region =
  | { kind: "box"; x0: number; y0: number; x1: number; y1: number }
  | { kind: "column_window"; x0: number; x1: number }
  | { kind: "slice"; z: number }
  | { kind: "frame_range"; t0: number; t1: number; seed?: { t: number; box: [number, number, number, number] } };
export interface Focus { object_id: string; kind: ObjectKind; index: Index; region: Region | null }
export interface ReferenceFrame { object_id: string; index: Index; origin: [number, number]; scale: number; width: number; height: number }
/** `time_ms`：时间序列对象该帧的源呈现时间（`X-Glaux-Frame-Time`），其余对象缺省。 */
export interface Observation { bytes: Uint8Array; mime: string; frame: ReferenceFrame; time_ms?: number }
export interface ToolProvider {
  name: string;
  /** `project`：只对绑定了项目的会话挂载（SDD 13 §7.3 规则 1）。 */
  requires: { vision?: boolean; egress?: boolean; runtime?: boolean; project?: true };
  supports(focus: Focus | undefined): boolean;
  create(context: HarnessToolContext): HarnessTool;
  promptFragment(context: HarnessToolContext): string;
}

/** 前端随 prompt 下发的当前观测焦点；四个旧字段只作 W5～W6 过渡输入。 */
export interface ViewerContext {
  collection?: string;
  task?: string;
  method?: string;
  object?: ObjectContext;
  focus?: Focus;
}

/**
 * 用户消息里内联的图像附件（SDD 00 §4.3 / D-021）。
 * `data` 是不带 `data:` 前缀的 base64；交给 `AgentHarness.prompt(text, { images })`。
 */
export interface PromptImage {
  data: string;
  mime_type: string;
}

/** 允许的附件 MIME（SDD 00 §4.3）——只收静态图像，领域影像走 run_task 不经此通道。 */
export const PROMPT_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

/** 单张 base64 上限，与 /atlas/describe 的 MAX_IMAGE_BASE64 对齐（~9MB 原图）。 */
export const MAX_PROMPT_IMAGE_BASE64 = 12 * 1024 * 1024;
/** 单条消息附件张数上限。 */
export const MAX_PROMPT_IMAGES = 6;
/** 单条消息附件 base64 合计上限。 */
export const MAX_PROMPT_IMAGES_TOTAL_BASE64 = 24 * 1024 * 1024;

export type TransportCommand =
  | {
      command_id: string;
      type: "prompt";
      content: string;
      images?: PromptImage[];
      connection: ConnectionInput;
      viewer?: ViewerContext;
      /** 显式调用的 Skill（SDD 17 §7.4）；与 `template` 互斥。 */
      skill?: string;
      /** 显式调用的提示词模板；`args` 按 pi `parseCommandArgs` 解析。 */
      template?: { name: string; args: string };
    }
  | {
      command_id: string;
      type: "regenerate";
      connection: ConnectionInput;
      viewer?: ViewerContext;
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
      event: "message.delta";
      data: { session_id: string; command_id: string; message: TranscriptMessage };
    }
  | {
      event: "message.end";
      data: { session_id: string; command_id: string };
    }
  | {
      /** SDD 18 §9.4：子智能体运行中的进度；`tool_call_id` 为主智能体 `agent` 调用的标识。 */
      event: "subagent.progress";
      data: { session_id: string; command_id: string; tool_call_id: string; turns: number; tool_name?: string };
    }
  | {
      event: "tool.start";
      data: { session_id: string; command_id: string; tool_call_id: string; tool_name: string; args: unknown };
    }
  | {
      event: "tool.end";
      data: {
        session_id: string;
        command_id: string;
        tool_call_id: string;
        tool_name: string;
        is_error: boolean;
        details: unknown;
        /** 出错时工具结果的文本（≤ 2000 字符），供前端显示拒绝或失败理由。 */
        error_text?: string;
      };
    }
  | {
      event: "interaction.request";
      data: InteractionRequest;
    }
  | {
      event: "interaction.resolved";
      data: { session_id: string; request_id: string; outcome: "answered" | "expired" | "cancelled" };
    }
  | {
      event: "context.compacted";
      data: { session_id: string };
    }
  | {
      event: "run.settled";
      data: { session_id: string; command_id: string; outcome: RunOutcome; budget: RunBudgetStats };
    }
  | {
      event: "video.answer";
      data: { session_id: string; command_id: string; answer: VideoAnswer };
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
