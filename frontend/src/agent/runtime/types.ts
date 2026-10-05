import type { Focus, ObjectMeta } from "../../api/types";

export type SessionStatus = "active" | "archived";
export type PermissionMode = "observe" | "suggest" | "controlled" | "autonomous";
export type SessionPhase = "idle" | "running" | "stopping" | "compacting" | "error";

export interface ContextUsage {
  tokens: number;
  context_window?: number;
  ratio?: number;
}

/** SDD 15 §9.6：由 Glaux 声明的消息结构，与 pi-ai 解耦。 */
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
      /** 工具执行耗时；命令结束后的快照才有（SDD 15 §9.6）。 */
      duration_ms?: number;
      /** 被插件拦截、未执行；命令结束后的快照才有。 */
      blocked?: true;
      /** `duration_ms` 中等待用户回复的部分；无等待时不出现。 */
      waited_ms?: number;
    };

export type ToolEffect = "read" | "annotate" | "compute" | "egress" | "write" | "exec" | "delegate";

/** SDD 15 §9.3：等待用户回复的交互请求。 */
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
    effect: ToolEffect;
    args_summary: string;
    grant_options: ("once" | "session" | "always")[];
  };
  question?: { question: string; options: string[]; allow_free_text: boolean };
  /** 来自子智能体时为其任务概括（SDD 18 §9.3）。 */
  origin?: { subagent: string };
  /** 主对话中与该请求关联的工具调用；已处理的记录显示在该调用之后（SDD 15 §9.3）。 */
  tool_call_id?: string;
}

/** SDD 15 §9.3：交互请求的回复。 */
export type InteractionReply =
  | { kind: "permission"; decision: "once" | "session" | "always" | "deny"; reason?: string }
  | { kind: "question"; option?: number; text?: string };

export type InteractionOutcome = "answered" | "expired" | "cancelled";

/** SDD 17 §9.1：Skills、模板与自定义说明的清单。 */
export type ResourceSource = "builtin" | "user" | "project";

export interface SkillItem {
  name: string;
  description: string;
  source: ResourceSource;
  path: string;
  enabled: boolean;
  model_invocable: boolean;
  overridden_by?: ResourceSource;
}

export interface TemplateItem {
  name: string;
  description?: string;
  source: "user" | "project";
  path: string;
  overridden_by?: "project";
}

/** SDD 18 §9.1：子智能体定义。 */
export interface AgentItem {
  name: string;
  description: string;
  source: ResourceSource;
  path: string;
  tools?: string[];
  max_turns: number;
  overridden_by?: "user" | "project";
}

export interface InstructionsItem {
  scope: "user" | "project";
  path: string;
  exists: boolean;
  bytes: number;
}

export interface ResourceDiagnostic {
  source: ResourceSource;
  code: string;
  message: string;
  path: string;
}

/** SDD 19 §9.1：工具目录条目。 */
export type ToolRequirement = "project" | "vision" | "runtime" | "egress";

export interface ToolItem {
  name: string;
  plugin: string;
  effect: ToolEffect;
  requires: ToolRequirement[];
}

export interface ResourceList {
  skills: SkillItem[];
  templates: TemplateItem[];
  instructions: InstructionsItem[];
  /** 旧版 runtime 不下发时视为空。 */
  agents?: AgentItem[];
  /** 旧版 runtime 不下发时视为空。 */
  tools?: ToolItem[];
  diagnostics: ResourceDiagnostic[];
}

/** SDD 19 §9.2：系统提示词预览。 */
export interface PromptSegment {
  kind: "base" | "plugin" | "instructions" | "skills" | "viewer";
  plugin?: string;
  scope?: "user" | "project";
  text: string;
  est_tokens: number;
}

export interface MountedTool {
  name: string;
  plugin: string;
  effect: ToolEffect | "";
  description: string;
  parameters: unknown;
  est_tokens: number;
}

export type UnmountedReason =
  | "needs_project" | "needs_vision" | "needs_runtime" | "needs_egress"
  | "plugin_inactive" | "unsupported_focus" | "mode";

export interface UnmountedTool {
  name: string;
  plugin: string;
  reason: UnmountedReason;
}

export interface SystemPromptPreview {
  prompt: string;
  segments: PromptSegment[];
  tools: MountedTool[];
  unmounted: UnmountedTool[];
  est_tokens: { prompt: number; tools: number };
}

export interface RuntimeWarning {
  code: string;
  message: string;
  path?: string;
}

export type RunOutcome = "completed" | "aborted" | "failed" | "budget_exceeded";

export interface SessionView {
  session_id: string;
  title: string;
  status: SessionStatus;
  permission_mode: PermissionMode;
  provider: string | null;
  model: string | null;
  phase: SessionPhase;
  messages: TranscriptMessage[];
  video_answers?: VideoAnswerRecord[];
  video_observations?: ClipObservation[];
  context_usage: ContextUsage | null;
  created_at: string;
  updated_at: string;
  /** 创建时绑定的项目，不可改；空为未归属（SDD 13 §7.6、§9.5）。 */
  project_id: string | null;
  /** 当前待决的交互请求（SDD 15 §9.7）；旧版 runtime 不下发时视为空。 */
  pending_interactions?: InteractionRequest[];
  warnings?: RuntimeWarning[];
}

export type SessionListItem = Omit<
  SessionView,
  "messages" | "video_answers" | "video_observations" | "pending_interactions" | "warnings"
>;

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
/**
 * 查看器上下文（SDD 10 §9.1）：``{collection, task, method, object, focus}``。
 * W5 起前端只下发五字段；runtime 在 W7 前仍兼容旧客户端的扁平字段。
 */
export interface ViewerContext {
  collection?: string;
  task?: string;
  method?: string;
  object?: Pick<ObjectMeta, "id" | "kind" | "axes" | "calibration">;
  focus?: Focus;
}

/** 用户消息内联图像附件（SDD 00 §4.3 / D-021）；`data` 为不带 `data:` 前缀的 base64。 */
export interface PromptImage {
  data: string;
  mime_type: string;
}

export type PromptLang = "en" | "zh";

export type TransportCommand =
  | {
      command_id: string;
      type: "prompt";
      content: string;
      images?: PromptImage[];
      connection: ConnectionInput;
      viewer?: ViewerContext;
      /** SDD 17 §9.3：显式调用，与 template 互斥。 */
      skill?: string;
      template?: { name: string; args: string };
      /** SDD 20 §7.1：系统提示词与工具定义的语言，取当前界面语言。 */
      lang?: PromptLang;
    }
  | {
      command_id: string;
      type: "regenerate";
      connection: ConnectionInput;
      viewer?: ViewerContext;
      lang?: PromptLang;
    }
  | {
      command_id: string;
      type: "abort";
    };

export type TransportEvent =
  | { event: "snapshot"; data: SessionView }
  | { event: "video.answer"; data: { session_id: string; command_id: string; answer: VideoAnswer } }
  | { event: "message.delta"; data: { session_id: string; command_id: string; message: TranscriptMessage } }
  | { event: "message.end"; data: { session_id: string; command_id: string } }
  | {
      event: "tool.start";
      data: { session_id: string; command_id: string; tool_call_id: string; tool_name: string; args: unknown };
    }
  | { event: "tool.end"; data: ToolEndData }
  | {
      /** SDD 18 §9.4：子智能体运行中的进度。 */
      event: "subagent.progress";
      data: { session_id: string; command_id: string; tool_call_id: string; turns: number; tool_name?: string };
    }
  | { event: "interaction.request"; data: InteractionRequest }
  | {
      event: "interaction.resolved";
      data: { session_id: string; request_id: string; outcome: InteractionOutcome };
    }
  | { event: "context.compacted"; data: { session_id: string } }
  | {
      event: "run.settled";
      data: {
        session_id: string;
        command_id: string;
        outcome: RunOutcome;
        budget: { turns: number; elapsed_ms: number; exhausted: boolean };
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

export interface ToolEndData {
  session_id: string;
  command_id: string;
  tool_call_id: string;
  tool_name: string;
  is_error: boolean;
  /** 被插件拦截、未执行（权限拒绝、越界、预算用尽）。 */
  blocked?: true;
  /** 该调用等待用户回复（审批、`ask_user`）的时长；无等待时不出现。 */
  waited_ms?: number;
  details: unknown;
  error_text?: string;
}

/** 除快照、视频答案、适配器错误以外，由 store 统一分发的运行事件。 */
export type RuntimeEvent = Exclude<TransportEvent, { event: "snapshot" | "video.answer" | "adapter.error" }>;

export const RUNTIME_EVENT_NAMES: readonly RuntimeEvent["event"][] = [
  "message.delta",
  "message.end",
  "tool.start",
  "tool.end",
  "subagent.progress",
  "interaction.request",
  "interaction.resolved",
  "context.compacted",
  "run.settled",
];

export interface RuntimeHealth {
  status: "ok";
  adapter: "ok";
  pi: "ok";
  storage: "ok";
  version?: string;
}

// ---------------------------------------------------------------------------
// SDD 21 运行轨迹
// ---------------------------------------------------------------------------

/** 模型返回的用量（pi-ai `Usage` 的子集，SDD 21 §7.4 规则 2）。 */
export interface TrajectoryUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning?: number;
}

export type TrajectoryBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "image"; mimeType: string; bytes: number }
  | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> };

export interface TrajectorySegment {
  kind: "base" | "plugin" | "instructions" | "skills" | "viewer";
  plugin?: string;
  scope?: "user" | "project";
  text: string;
  est_tokens: number;
}

export interface TrajectoryTool {
  name: string;
  plugin: string;
  effect: string;
  description: string;
  parameters: unknown;
  est_tokens: number;
}

export interface RequestHeaderBody {
  prompt: string;
  segments: TrajectorySegment[];
  tools: TrajectoryTool[];
  est_tokens: { prompt: number; tools: number };
}



interface TrajectoryItemBase {
  item_id: string;
  at: number;
}

export type TrajectoryItem =
  | (TrajectoryItemBase & { kind: "user"; content: TrajectoryBlock[] })
  | (TrajectoryItemBase & {
      kind: "header";
      hash: string;
      provider: string;
      model: string;
      context_window: number;
      lang: string;
      permission_mode: string;
      changed: "initial" | "same" | "changed";
    })
  | (TrajectoryItemBase & {
      kind: "model";
      step: number;
      content: TrajectoryBlock[];
      stop_reason: string;
      error_message?: string;
      usage: TrajectoryUsage;
      timing?: { started_at: number; first_token_ms?: number; duration_ms: number };
      request?: {
        message_count: number;
        pruned_images: number;
        injected_count: number;
        est_tokens: { system: number; tools: number; messages: number };
      };
    })
  | (TrajectoryItemBase & {
      kind: "tool";
      tool_call_id: string;
      name: string;
      arguments: Record<string, unknown>;
      result: TrajectoryBlock[];
      is_error: boolean;
      blocked: boolean;
      duration_ms?: number;
      waited_ms?: number;
      subagent?: {
        subagent_type: string;
        description: string;
        outcome: string;
        turns: number;
        transcript: TranscriptMessage[];
      };
    })
  | (TrajectoryItemBase & {
      kind: "compaction";
      tokens_before: number;
      summary: string;
      summary_est_tokens: number;
      kept: { count: number; est_tokens: number };
      usage?: TrajectoryUsage;
    })
  | (TrajectoryItemBase & {
      kind: "notice";
      type: "budget" | "permission" | "model_change";
      /** 原条目的数据，由前端按 `type` 格式化（界面双语）。 */
      data: Record<string, unknown>;
    });

export interface TrajectoryTurn {
  index: number;
  command_id?: string;
  command_type?: string;
  started_at?: number;
  ended_at?: number;
  outcome: RunOutcome | "running" | "unknown";
  items: TrajectoryItem[];
}

export interface Trajectory {
  session_id: string;
  turns: TrajectoryTurn[];
  headers: Record<string, RequestHeaderBody>;
  totals: {
    turns: number;
    model_calls: number;
    tool_calls: number;
    usage: { input: number; output: number; cache_read: number; cache_write: number };
  };
}

export interface RequestContextMessage {
  role: "user" | "assistant" | "toolResult" | "compactionSummary" | "branchSummary" | "custom";
  content: TrajectoryBlock[];
  est_tokens: number;
  marks: ("pruned" | "injected")[];
}

export interface RequestContext {
  item_id: string;
  header_hash?: string;
  turn_index: number;
  matched: boolean;
  recorded_count?: number;
  messages: RequestContextMessage[];
}
