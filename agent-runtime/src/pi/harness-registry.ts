import { chatEdition, CHAT_SYSTEM_PROMPTS } from "../edition.js";
import { randomUUID } from "node:crypto";

import {
  AgentHarness,
  DEFAULT_COMPACTION_SETTINGS,
  estimateContextTokens,
  shouldCompact,
  type AgentHarnessTool,
  type ExecutionEnv,
  type Session,
} from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import type { Model, Models } from "@earendil-works/pi-ai";
import type { SqliteSessionMetadata } from "@earendil-works/pi-storage-sqlite-node";

import type {
  ConnectionInput,
  PermissionMode,
  RunOutcome,
  SessionPhase,
  TransportEvent,
  ViewerContext,
} from "../contracts.js";
import { RuntimeError } from "../errors.js";
import { sessionProjectId, TOOL_TIMING_ENTRY, type SessionService } from "./session-service.js";
import {
  createModelRuntime,
  type ModelRuntime,
} from "./model-runtime.js";
import { activePlugins, availableTools, pluginTools, promptFragmentParts } from "../plugins/registry.js";
import { installHooks } from "../plugins/compose.js";
import { mapPiEvent } from "../transport/event-map.js";
import { ProjectScope } from "./tools/project-guard.js";
import { mountable } from "../permission/decide.js";
import { defaultLoadSettings, restoreGrants } from "../permission/load.js";
import type { PermissionDeps, PermissionRunState } from "../permission/plugin.js";
import type { RuntimeWarning } from "../contracts.js";
import { VideoTurn } from "./video-turn.js";
import { InteractionTable } from "../interaction/table.js";
import { resolveBudget, RunBudget } from "../budget/run-budget.js";
import { installWindDown } from "../budget/wind-down.js";
import { loadResources, type LoadedResources, type PromptExtraPart } from "../resources/load.js";
import { buildPreview, type SystemPromptPreview } from "./prompt-preview.js";
import { langOf, type Bilingual, type PromptLang } from "../i18n/prompt-lang.js";
import { defaultWorkspacesRoot, resolveCwd } from "../workspace/cwd.js";
import { buildShellEnv } from "../workspace/shell-env.js";
import type { AgentDefinition } from "../resources/agents.js";
import { createSlots, runSubagent, type SubagentRequest, type SubagentResult } from "../subagents/run.js";
import type { RequestHeaderEntry } from "../contracts.js";
import { fullBranch } from "../trajectory/branch.js";
import { MODEL_CALL_ENTRY, ModelCallRecorder, REQUEST_HEADER_ENTRY, requestHeader } from "../trajectory/capture.js";

export interface HarnessRuntimeFactory {
  (connection: ConnectionInput): ModelRuntime;
}

/** 每次 start 的领域上下文——工具集据此构造（当前图 / 当前任务 / 权限模式）。 */
export interface HarnessStartOptions {
  viewer?: ViewerContext;
  permissionMode?: PermissionMode;
  /** 显式调用的 Skill 或模板必须存在且可用，否则 422 unknown_resource（SDD 17 §7.4 规则 3）。 */
  requires?: { skill?: string; template?: string };
  /** 系统提示词与工具定义的语言（SDD 20 §7.1）；缺省英文。子智能体随上下文继承。 */
  lang?: PromptLang;
}

/** 工具工厂拿到的完整上下文：领域上下文 + 本次连接与其模型运行时（图谱检索需要向模型发图）。 */
export interface HarnessToolContext extends HarnessStartOptions {
  connection?: ConnectionInput;
  runtime?: ModelRuntime;
  videoTurn?: VideoTurn;
  /** 会话绑定的项目（SDD 13 §7.6），由 `start()` 从 Pi 会话 metadata 读出；未归属会话缺省。 */
  projectId?: string;
  /** 交互请求表与本次命令标识（SDD 15 §7.6）；`ask_user` 与权限审批经它挂起。 */
  interactions?: InteractionTable;
  run?: { sessionId: string; commandId: string };
  /** 本命令的工作目录与执行环境（SDD 16 §7.1）；取不到时缺省，基础工具不挂载。 */
  cwd?: string;
  execEnv?: ExecutionEnv;
  /** 可用的子智能体定义与派发函数（SDD 18 §7.1）；`subagent` 表示本上下文属于子智能体。 */
  agents?: AgentDefinition[];
  spawnSubagent?: (request: SubagentRequest, options?: { signal?: AbortSignal; toolCallId?: string }) => Promise<SubagentResult>;
  subagent?: { description: string; toolCallId?: string };
}

export type HarnessTool = AgentHarnessTool<undefined>;

export interface HarnessToolFactory {
  (options: HarnessToolContext): HarnessTool[];
}

/**
 * 缺省工具集：插件登记表中本次可挂载、且命令开始时的权限模式允许挂载的工具（SDD 15 §7.1、§7.4）。
 * 越界、规则与审批在 `permission` 插件的 `tool_call` 钩子中判定。
 */
export const defaultToolFactory: HarnessToolFactory = (context) => {
  if (chatEdition()) return [];
  const mode = context.permissionMode ?? "controlled";
  return availableTools(context)
    .filter((provider) => mountable(provider.effect, mode))
    .map((provider) => provider.create(context));
};

const SYSTEM_PROMPT: Bilingual = {
  en: "You are Glaux's built-in reference assistant for image and video analysis: natural images and video, " +
    "microscopy and pathology, and medical imaging. For medical and pathology images your output supports research, " +
    "not clinical diagnosis. " +
    "Glaux is the environment you act in: it decodes images, runs calibrated segmentation and measurement, " +
    "and verifies results. When the user asks to measure, segment, or analyse the current image, call the " +
    "run_task tool instead of guessing numbers; report the returned metrics faithfully with units. " +
    "If the request is out of Glaux's registered tasks, say so plainly rather than inventing a result.",
  zh: "你是 Glaux 内置的参考助手，负责图像与视频分析：自然图像与视频、显微与病理图像、医学影像。" +
    "对医学与病理图像，你的输出用于科研，不用于临床诊断。" +
    "Glaux 是你工作的环境：它负责解码图像、运行标定过的分割与测量，并核验结果。" +
    "用户要求测量、分割或分析当前图像时，调用 run_task 工具，不要猜测数值；如实报告返回的指标并带上单位。" +
    "如果请求超出 Glaux 已登记的任务，直接说明，不要编造结果。",
};

/** 子智能体系统提示词末尾的说明（SDD 18 §7.2、SDD 20 §5）。 */
const SUBAGENT_LAST_REPLY: Bilingual = {
  en: "Only your last reply will be passed to the main agent.",
  zh: "只有你的最后一条回复会交给主智能体。",
};

/** 查看器上下文的外层句子（SDD 20 §7.2 规则 3）；机器字段不翻译。 */
const VIEWER_TEXT = {
  none: {
    en: "No image is currently open in the viewer.",
    zh: "查看器中当前没有打开图像。",
  },
  videoUnsupported: {
    en: "The current connection does not support joint audio-video Q&A. Say so explicitly when asked about the video; ordinary conversation remains available.",
    zh: "当前连接不支持音画联合问答。被问到视频时要明确说明这一点；普通对话仍然可用。",
  },
  frameTime: {
    en: "average frame period; view_current_image returns the exact source time",
    zh: "按平均帧间隔估算；view_current_image 返回精确的源时间",
  },
  label: {
    en: "Viewer context (catalogue labels recorded by the dataset and the UI, not a description of what the image shows)",
    zh: "查看器上下文（数据集与界面记录的目录标签，不是画面内容的描述）",
  },
} satisfies Record<string, Bilingual>;

/** SDD 19 §9.2：系统提示词的一段；`text` 不含段间分隔符。 */
export interface PromptSegmentDraft {
  kind: "base" | "plugin" | "instructions" | "skills" | "viewer";
  plugin?: string;
  scope?: "user" | "project";
  text: string;
}

function composePrompt(head: string, extras: string, tail: string): string {
  return extras ? `${head}\n\n${extras}\n\n${tail}` : `${head} ${tail}`;
}

/** 系统提示词按来源分段：基础段 → 插件片段 → 说明段与 Skills 目录段 → 查看器上下文（SDD 17 §7.2）。 */
export function systemPromptSegments(
  viewer: ViewerContext | undefined,
  tools: HarnessTool[],
  context: HarnessToolContext,
  videoDescription?: { duration_ms: number; has_audio: boolean },
  extras: readonly PromptExtraPart[] = [],
): PromptSegmentDraft[] {
  const mounted = new Set(tools.map((tool) => tool.name));
  return [
    { kind: "base", text: SYSTEM_PROMPT[langOf(context)] },
    ...promptFragmentParts(context, mounted).map((part): PromptSegmentDraft => ({ kind: "plugin", plugin: part.plugin, text: part.text })),
    ...extras.map((part): PromptSegmentDraft => part.kind === "instructions"
      ? { kind: "instructions", scope: part.scope, text: part.text }
      : { kind: "skills", text: part.text }),
    { kind: "viewer", text: viewerTail(viewer, context, videoDescription) },
  ];
}

/** 按 SDD 17 §7.2 的分隔规则把分段拼成系统提示词。 */
export function joinSystemPrompt(segments: readonly PromptSegmentDraft[]): string {
  const text = (kinds: PromptSegmentDraft["kind"][], separator: string) =>
    segments.filter((segment) => kinds.includes(segment.kind)).map((segment) => segment.text).join(separator);
  return composePrompt(text(["base", "plugin"], ""), text(["instructions", "skills"], "\n\n"), text(["viewer"], ""));
}

/**
 * 系统提示词 = 基础段 + 插件片段 + 说明段与 Skills 目录段（`extras`，SDD 17 §7.2）+ 查看器上下文。
 * `extras` 为空时与 SDD 17 之前逐字一致。子智能体在 `extras` 中追加自己的定义段。
 */
export function systemPromptFor(
  viewer: ViewerContext | undefined,
  tools: HarnessTool[],
  context: HarnessToolContext,
  videoDescription?: { duration_ms: number; has_audio: boolean },
  extras = "",
): string {
  const segments = systemPromptSegments(viewer, tools, context, videoDescription);
  return composePrompt(
    segments.filter((segment) => segment.kind !== "viewer").map((segment) => segment.text).join(""),
    extras,
    segments.at(-1)!.text,
  );
}

function viewerTail(
  viewer: ViewerContext | undefined,
  context: HarnessToolContext,
  videoDescription?: { duration_ms: number; has_audio: boolean },
): string {
  const lang = langOf(context);
  if (!viewer?.focus) return VIEWER_TEXT.none[lang];
  if (viewer.focus.kind === "video" && !context.videoTurn) return VIEWER_TEXT.videoUnsupported[lang];
  const parts = [`object_id=${viewer.focus.object_id}`, `kind=${viewer.object?.kind ?? viewer.focus.kind}`];
  const index = Object.entries(viewer.focus.index).filter(([, value]) => value != null)
    .map(([axis, value]) => `${axis}:${value}`).join(",");
  if (index) parts.push(`index={${index}}`);
  const t = viewer.focus.index.t;
  const timeAxis = viewer.object?.axes.find((axis) => axis.name === "t" && axis.unit === "ms" && axis.spacing);
  if (t != null && timeAxis?.spacing) {
    const note = lang === "zh" ? `（${VIEWER_TEXT.frameTime.zh}）` : ` (${VIEWER_TEXT.frameTime.en})`;
    parts.push(`current_frame_time_ms≈${Math.round(t * timeAxis.spacing)}${note}`);
  }
  if (viewer.task) parts.push(`task=${viewer.task}`);
  if (viewer.collection) parts.push(`collection=${viewer.collection}`);
  if (viewer.method) parts.push(`method=${viewer.method}`);
  if (videoDescription) parts.push(`duration_ms=${videoDescription.duration_ms}`, `has_audio=${videoDescription.has_audio}`);
  // 措辞刻意强调"目录标签"：这几个字段来自数据集与 UI 选择，不代表画面内容。
  // 早期版本只给这一行，模型便把标签当观察复述，用户看到的图与模型说的对不上。
  return lang === "zh"
    ? `${VIEWER_TEXT.label.zh}：${parts.join(", ")}。`
    : `${VIEWER_TEXT.label.en}: ${parts.join(", ")}.`;
}

interface Assembled {
  runtime: ModelRuntime;
  videoTurn?: VideoTurn;
  projectId: string | null;
  permission?: PermissionRunState;
  resources?: LoadedResources;
  toolContext: HarnessToolContext;
  tools: HarnessTool[];
  systemPrompt: string;
  /** `systemPrompt` 的来源分段（SDD 19 §9.2）。 */
  segments: PromptSegmentDraft[];
}

function assertRequiredResources(requires: HarnessStartOptions["requires"], resources: LoadedResources | undefined): void {
  if (!requires) return;
  const missing = requires.skill !== undefined && !resources?.harnessSkills.some((skill) => skill.name === requires.skill)
    ? `skill ${requires.skill}`
    : requires.template !== undefined && !resources?.harnessTemplates.some((template) => template.name === requires.template)
      ? `template ${requires.template}`
      : undefined;
  if (missing) throw new RuntimeError("unknown_resource", `Unknown or disabled ${missing}.`, 422);
}

interface HarnessSlot {
  session: Session;
  harness: AgentHarness;
  phase: SessionPhase;
  commandId: string;
  disposeCredential: () => void;
  unsubscribeHarness: () => void;
  completion: Promise<void>;
  /** 本命令的回合数与起始时刻，供 `run.settled` 与预算使用（SDD 15 §7.8）。 */
  stats: { turns: number; startedAt: number };
  /** 本命令的运行预算；chat 发行版缺省。 */
  budget?: RunBudget;
  /** 运行中产生的审计记录，命令结束时按顺序写入会话。 */
  audit: { customType: string; data: unknown }[];
}

type TransportListener = (event: Exclude<TransportEvent, { event: "snapshot" }>) => void;

export class HarnessRegistry {
  private readonly slots = new Map<string, HarnessSlot>();
  private readonly listeners = new Map<string, Set<TransportListener>>();

  /** SDD 15 §7.6：全部会话共用一张交互请求表。 */
  readonly interactions: InteractionTable;
  /** 最近一次命令加载设置文件时的告警，按会话保存，供快照 `warnings`（SDD 15 §9.7）。 */
  private readonly settingsWarnings = new Map<string, RuntimeWarning[]>();

  constructor(
    private readonly sessions: SessionService,
    private readonly runtimeFactory: HarnessRuntimeFactory = createModelRuntime,
    private readonly toolFactory: HarnessToolFactory = defaultToolFactory,
    interactionTimeoutMs?: number,
    private readonly permissionDeps: PermissionDeps = {},
  ) {
    this.interactions = new InteractionTable({
      emit: (sessionId, event) => this.emit(sessionId, event),
      audit: (sessionId, record) => this.appendAudit(sessionId, "glaux.interaction", record),
      ...(interactionTimeoutMs !== undefined ? { timeoutMs: interactionTimeoutMs } : {}),
    });
  }

  getPhase(sessionId: string): SessionPhase {
    return this.slots.get(sessionId)?.phase ?? "idle";
  }

  warningsFor(sessionId: string): RuntimeWarning[] {
    return this.settingsWarnings.get(sessionId) ?? [];
  }

  getActiveCommandId(sessionId: string): string | undefined {
    return this.slots.get(sessionId)?.commandId;
  }

  subscribe(sessionId: string, listener: TransportListener): () => void {
    const listeners = this.listeners.get(sessionId) ?? new Set<TransportListener>();
    listeners.add(listener);
    this.listeners.set(sessionId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(sessionId);
    };
  }

  async start(
    sessionId: string,
    commandId: string,
    connection: ConnectionInput,
    operation: (harness: AgentHarness, session: Session) => Promise<void>,
    options: HarnessStartOptions = {},
  ): Promise<{ completion: Promise<void> }> {
    if (this.getPhase(sessionId) !== "idle") {
      throw new RuntimeError("session_busy", "Session is already generating.", 409);
    }
    if (this.slots.has(sessionId)) await this.evict(sessionId);

    const session = await this.sessions.openSession(sessionId);
    let assembled: Assembled;
    try {
      assembled = await this.assemble(sessionId, commandId, connection, session, options);
      assertRequiredResources(options.requires, assembled.resources);
    } catch (error) {
      await this.sessions.closeSession(session);
      throw error;
    }
    const { runtime, videoTurn, projectId, permission, resources, toolContext, tools, systemPrompt } = assembled;
    // SDD 21 §7.1 规则 1、2：请求头随审计队列在命令结束时写入；同分支已有相同哈希的全文时只写引用。
    let header: RequestHeaderEntry | undefined;
    try {
      header = await this.requestHeaderFor(session, commandId, assembled, options);
    } catch (error) {
      console.error("request header capture failed", { sessionId, error });
    }
    // SDD 15 §7.8：预算上限取自已加载的设置；宽限用尽时异步中止，不在 pi 回调内等待空闲。
    const budget = permission ? new RunBudget({
      limits: resolveBudget(permission.settings),
      waitedMs: () => this.interactions.waitedMs(sessionId, commandId),
      onAbort: () => { setImmediate(() => void this.abort(sessionId)); },
    }) : undefined;
    const harness = new AgentHarness({
      session,
      models: runtime.models,
      model: runtime.model,
      systemPrompt,
      tools,
      ...(resources ? { resources: { skills: resources.harnessSkills, promptTemplates: resources.harnessTemplates } } : {}),
    });
    // SDD 15 §7.2：每种钩子只注册一个组合后的 handler；chat 发行版不挂插件。
    // 被拦截的工具调用：`tool.end` 与耗时记录据此标出「未执行」（SDD 15 §5.1）
    const blocked = new Set<string>();
    const recorder = new ModelCallRecorder(commandId);
    const uninstallHooks = installHooks(harness, chatEdition() ? [] : activePlugins(toolContext), {
      sessionId,
      commandId,
      ...(projectId ? { projectId } : {}),
      ...(options.viewer ? { viewer: options.viewer } : {}),
      ...(permission ? { permission } : {}),
      ...(budget ? { budget } : {}),
    }, undefined, (toolCallId) => blocked.add(toolCallId), (before, after) => recorder.onContext(before, after));
    const stats = { turns: 0, startedAt: Date.now() };
    const audit: HarnessSlot["audit"] = header ? [{ customType: REQUEST_HEADER_ENTRY, data: header }] : [];
    // 工具耗时（SDD 15 §12）：含等待审批的时间，与用户感知一致。
    const toolStarts = new Map<string, number>();
    // 其中等待用户回复（审批、ask_user）的时长另记，展示时从耗时里扣除
    const waitedMs = (toolCallId: string) => this.interactions.waitedForCall(sessionId, commandId, toolCallId);
    const unsubscribeEvents = harness.subscribe((event) => {
      if (event.type === "turn_start") {
        stats.turns += 1;
        budget?.onTurnStart();
      }
      try {
        const modelCall = recorder.onEvent(event);
        if (modelCall) audit.push({ customType: MODEL_CALL_ENTRY, data: modelCall });
      } catch (error) {
        console.error("model call capture failed", { sessionId, error });
      }
      if (event.type === "tool_execution_start") toolStarts.set(event.toolCallId, Date.now());
      if (event.type === "tool_execution_end") {
        const started = toolStarts.get(event.toolCallId);
        toolStarts.delete(event.toolCallId);
        if (started !== undefined) {
          const waited = waitedMs(event.toolCallId);
          audit.push({
            customType: TOOL_TIMING_ENTRY,
            data: {
              tool_call_id: event.toolCallId,
              duration_ms: Date.now() - started,
              ...(waited > 0 ? { waited_ms: waited } : {}),
              ...(blocked.has(event.toolCallId) ? { blocked: true } : {}),
            },
          });
        }
      }
      const mapped = mapPiEvent(sessionId, commandId, event, { blocked, waitedMs });
      if (mapped) this.emit(sessionId, mapped);
    });
    // SDD 15 §7.8 规则 3：收尾回合禁止调用工具。
    const uninstallWindDown = budget ? installWindDown(harness, budget) : () => undefined;
    const unsubscribeHarness = () => {
      unsubscribeEvents();
      uninstallHooks();
      uninstallWindDown();
    };
    const slot: HarnessSlot = {
      session,
      harness,
      phase: "running",
      commandId,
      disposeCredential: runtime.disposeCredential,
      unsubscribeHarness,
      completion: Promise.resolve(),
      stats,
      audit,
      ...(budget ? { budget } : {}),
    };
    this.slots.set(sessionId, slot);

    slot.completion = (async () => {
      try {
        await this.compactIfNeeded(slot, runtime.models, runtime.model);
        slot.phase = "running";
        await operation(harness, session);
        await videoTurn?.finalize();
      } finally {
        // 失败结束的命令也不留待决请求（SDD 15 §7.6）。
        this.interactions.cancelCommand(sessionId, commandId);
        if (budget) {
          budget.dispose();
          slot.audit.push({
            customType: "glaux.budget",
            data: {
              command_id: commandId,
              turns: stats.turns,
              elapsed_ms: budget.elapsedMs(),
              waited_ms: this.interactions.waitedMs(sessionId, commandId),
              max_turns: budget.limits.maxTurns,
              max_minutes: budget.limits.maxMinutes,
              exhausted: budget.exhausted,
              aborted_by_budget: budget.abortedByBudget,
            },
          });
        }
        this.interactions.forgetCommand(sessionId, commandId);
        await this.flushAudit(slot);
        runtime.disposeCredential();
        slot.phase = "idle";
      }
    })();

    return { completion: slot.completion };
  }

  async abort(sessionId: string): Promise<void> {
    const slot = this.slots.get(sessionId);
    if (!slot || slot.phase === "idle") return;
    slot.phase = "stopping";
    // 先取消待决交互，否则挂起在钩子或工具里的调用会让 abort 一直等待（SDD 15 §7.6 规则 6）。
    this.interactions.cancelCommand(sessionId, slot.commandId);
    await slot.harness.abort();
    await slot.harness.waitForIdle();
    slot.phase = "idle";
  }

  async waitForIdle(sessionId: string): Promise<void> {
    const slot = this.slots.get(sessionId);
    if (!slot) return;
    await slot.completion.catch(() => undefined);
  }

  async evict(sessionId: string): Promise<void> {
    const slot = this.slots.get(sessionId);
    if (!slot) return;
    if (slot.phase !== "idle") {
      throw new RuntimeError("session_busy", "Session is already generating.", 409);
    }
    slot.unsubscribeHarness();
    slot.disposeCredential();
    await this.sessions.closeSession(slot.session);
    this.slots.delete(sessionId);
  }

  async close(): Promise<void> {
    for (const sessionId of [...this.slots.keys()]) {
      await this.abort(sessionId);
      await this.waitForIdle(sessionId);
      await this.evict(sessionId);
    }
  }

  emitAdapterError(
    sessionId: string,
    commandId: string | undefined,
    error: RuntimeError,
  ): void {
    this.emit(sessionId, {
      event: "adapter.error",
      data: {
        session_id: sessionId,
        ...(commandId ? { command_id: commandId } : {}),
        code: error.code,
        message: error.message,
        trace_id: randomUUID(),
      },
    });
  }

  private async compactIfNeeded(
    slot: HarnessSlot,
    models: Models,
    model: Model<string>,
  ): Promise<void> {
    const context = await slot.session.buildContext();
    const usage = estimateContextTokens(context.messages);
    if (!shouldCompact(usage.tokens, model.contextWindow, DEFAULT_COMPACTION_SETTINGS)) {
      return;
    }
    slot.phase = "compacting";
    await slot.harness.compact();
  }

  /**
   * 命令开始时的装配：模型运行时、视频回合、项目、权限状态、资源、工具与系统提示词。
   * 命令与系统提示词预览（SDD 17 §7.5 规则 7）共用，保证预览与真实命令一致。出错时释放凭据。
   */
  private async assemble(
    sessionId: string,
    commandId: string,
    connection: ConnectionInput,
    session: Session<SqliteSessionMetadata>,
    options: HarnessStartOptions,
  ): Promise<Assembled> {
    const runtime = this.runtimeFactory(connection);
    try {
      const videoTurn = runtime.videoMedia && options.viewer?.focus?.kind === "video"
        ? new VideoTurn(options.viewer.focus.object_id, commandId, session, runtime.videoMedia,
            (answer) => this.emit(sessionId, { event: "video.answer", data: { session_id: sessionId, command_id: commandId, answer } }))
        : undefined;
      // 项目绑定只存 Pi metadata（SDD 13 D-5）；浏览工具挂载与越界校验都以它为准。
      const projectId = sessionProjectId(await session.getMetadata());
      const videoDescription = videoTurn ? await videoTurn.describe() : undefined;
      const prepared = chatEdition() ? undefined : await this.preparePermission(sessionId, session, projectId, options);
      const permission = prepared?.permission;
      const resources = prepared?.resources;
      const toolContext: HarnessToolContext = {
        ...options,
        connection,
        runtime,
        ...(videoTurn ? { videoTurn } : {}),
        ...(projectId ? { projectId } : {}),
        interactions: this.interactions,
        run: { sessionId, commandId },
        ...(permission?.cwd ? {
          cwd: permission.cwd,
          execEnv: new NodeExecutionEnv({ cwd: permission.cwd, shellEnv: buildShellEnv(permission.cwd) }),
        } : {}),
      };
      if (permission && resources?.harnessAgents.length) {
        toolContext.agents = resources.harnessAgents;
        toolContext.spawnSubagent = this.subagentSpawner({
          sessionId, commandId, toolContext, permission, resources, runtime,
          ...(projectId ? { projectId } : {}),
          ...(videoDescription ? { videoDescription } : {}),
        });
      }
      const tools = chatEdition() ? [] : this.toolFactory(toolContext);
      const segments: PromptSegmentDraft[] = chatEdition()
        ? [{ kind: "base", text: CHAT_SYSTEM_PROMPTS[langOf(options)] }]
        : systemPromptSegments(options.viewer, tools, toolContext, videoDescription, resources?.promptExtraParts);
      const systemPrompt = chatEdition() ? segments[0]!.text : joinSystemPrompt(segments);
      return {
        runtime, projectId, toolContext, tools, systemPrompt, segments,
        ...(videoTurn ? { videoTurn } : {}),
        ...(permission ? { permission } : {}),
        ...(resources ? { resources } : {}),
      };
    } catch (error) {
      runtime.disposeCredential();
      throw error;
    }
  }

  /**
   * SDD 18 §7.2：派发函数。子智能体用父命令的模型运行时、权限状态与交互请求表；
   * 工具取父上下文可挂载工具与定义 `tools` 的交集；同一主命令内并发不超过 3 个。
   */
  private subagentSpawner(parent: {
    sessionId: string;
    commandId: string;
    projectId?: string;
    toolContext: HarnessToolContext;
    permission: PermissionRunState;
    resources: LoadedResources;
    runtime: ModelRuntime;
    videoDescription?: { duration_ms: number; has_audio: boolean };
  }): NonNullable<HarnessToolContext["spawnSubagent"]> {
    const slots = createSlots();
    return async (request, { signal, toolCallId } = {}) => {
      const definition = parent.resources.harnessAgents.find((def) => def.name === request.subagent_type);
      if (!definition) throw new RuntimeError("unknown_resource", `Unknown sub-agent ${request.subagent_type}.`, 422);
      const release = await slots.acquire(signal);
      try {
        const { spawnSubagent: _spawn, ...inherited } = parent.toolContext;
        const childContext: HarnessToolContext = {
          ...inherited,
          subagent: { description: request.description, ...(toolCallId ? { toolCallId } : {}) },
        };
        const allowed = definition.tools ? new Set(definition.tools) : undefined;
        const tools = this.toolFactory(childContext).filter((tool) => !allowed || allowed.has(tool.name));
        const extras = [
          parent.resources.promptExtras,
          `<subagent name="${definition.name}">\n${definition.body}\n</subagent>\n` + SUBAGENT_LAST_REPLY[langOf(childContext)],
        ].filter(Boolean).join("\n\n");
        const viewer = childContext.viewer;
        const waited = () => this.interactions.waitedMs(parent.sessionId, parent.commandId);
        const waitedAtStart = waited();
        return await runSubagent(request.prompt, {
          definition,
          runtime: parent.runtime,
          tools,
          systemPrompt: systemPromptFor(viewer, tools, childContext, parent.videoDescription, extras),
          resources: { skills: parent.resources.harnessSkills, promptTemplates: parent.resources.harnessTemplates },
          plugins: activePlugins(childContext),
          runContext: {
            sessionId: parent.sessionId,
            commandId: parent.commandId,
            ...(parent.projectId ? { projectId: parent.projectId } : {}),
            ...(viewer ? { viewer } : {}),
            permission: parent.permission,
            origin: { subagent: request.description },
            ...(toolCallId ? { anchorToolCallId: toolCallId } : {}),
          },
          maxMinutes: resolveBudget(parent.permission.settings).maxMinutes,
          waitedMs: () => waited() - waitedAtStart,
          ...(signal ? { signal } : {}),
          ...(toolCallId ? {
            onProgress: (progress) => this.emit(parent.sessionId, {
              event: "subagent.progress",
              data: { session_id: parent.sessionId, command_id: parent.commandId, tool_call_id: toolCallId, ...progress },
            }),
          } : {}),
        });
      } finally {
        release();
      }
    };
  }

  /**
   * SDD 17 §7.5 规则 7、SDD 19 §9.2：按当前连接与查看器上下文组装系统提示词与工具，
   * 返回分段、工具定义与未挂载原因；不启动命令、不调用模型。
   */
  async previewSystemPrompt(
    sessionId: string, connection: ConnectionInput, viewer?: ViewerContext, lang?: PromptLang,
  ): Promise<SystemPromptPreview> {
    const meta = this.sessions.metaRepo.get(sessionId);
    if (!meta) throw new RuntimeError("session_not_found", "Session not found.", 404);
    const session = await this.sessions.openSession(sessionId);
    try {
      const assembled = await this.assemble(sessionId, "preview", connection, session, {
        permissionMode: meta.permission_mode,
        ...(viewer ? { viewer } : {}),
        ...(lang ? { lang } : {}),
      });
      assembled.runtime.disposeCredential();
      return buildPreview({
        prompt: assembled.systemPrompt,
        segments: assembled.segments,
        tools: assembled.tools,
        context: chatEdition() ? undefined : assembled.toolContext,
        mode: assembled.toolContext.permissionMode ?? "controlled",
      });
    } finally {
      await this.sessions.closeSession(session);
    }
  }

  /** SDD 21 §9.1：本命令的请求头；分段、工具与估算与预览同一构造。 */
  private async requestHeaderFor(
    session: Session, commandId: string, assembled: Assembled, options: HarnessStartOptions,
  ): Promise<RequestHeaderEntry> {
    const knownHashes = new Set<string>();
    for (const entry of await fullBranch(session)) {
      if (entry.type !== "custom" || entry.customType !== REQUEST_HEADER_ENTRY) continue;
      const data = entry.data as Partial<RequestHeaderEntry> | undefined;
      if (typeof data?.hash === "string" && data.body) knownHashes.add(data.hash);
    }
    const mode = assembled.toolContext.permissionMode ?? "controlled";
    const { prompt, segments, tools, est_tokens } = buildPreview({
      prompt: assembled.systemPrompt,
      segments: assembled.segments,
      tools: assembled.tools,
      context: undefined,
      mode,
    });
    const model = assembled.runtime.model;
    return requestHeader({
      commandId,
      body: { prompt, segments, tools, est_tokens },
      provider: model.provider,
      model: model.id,
      contextWindow: model.contextWindow,
      lang: options.lang ?? "en",
      permissionMode: chatEdition() ? "" : mode,
      knownHashes,
    });
  }

  /** SDD 15 §7.5：本命令的权限判定状态。越界作用域与设置加载可由测试注入。 */
  private async preparePermission(
    sessionId: string,
    session: Session,
    projectId: string | null,
    options: HarnessStartOptions,
  ): Promise<{ permission: PermissionRunState; resources: LoadedResources }> {
    const scopeOptions = {
      ...(projectId ? { projectId } : {}),
      ...(options.viewer ? { viewer: options.viewer } : {}),
    };
    const { settings, alwaysPath, projectDir } = await (this.permissionDeps.loadSettings ?? defaultLoadSettings)(projectId ?? undefined);
    this.settingsWarnings.set(sessionId, settings.warnings);
    const cwd = await resolveCwd({
      sessionId,
      ...(projectId ? { projectId } : {}),
      ...(projectDir ? { projectDir } : {}),
      workspacesRoot: this.permissionDeps.workspacesRoot ?? defaultWorkspacesRoot(),
    });
    // SDD 17 §7.1：Skills、模板与说明随命令加载；停用列表只取用户级设置。
    const resources = await (this.permissionDeps.loadResources ?? loadResources)({
      ...(projectDir ? { projectDir } : {}),
      disabledSkills: settings.user?.skillsDisabled ?? [],
      ...(options.lang ? { lang: options.lang } : {}),
    });
    const permission: PermissionRunState = {
      getMode: () => this.sessions.metaRepo.get(sessionId)?.permission_mode ?? options.permissionMode ?? "controlled",
      tools: new Map(pluginTools().map((tool) => [tool.name, tool])),
      // 一次命令一个作用域：越界查询结果只在本命令内缓存（SDD 13 §7.8 规则 4）。
      scope: this.permissionDeps.projectScope?.(scopeOptions) ?? new ProjectScope(scopeOptions),
      settings,
      grants: await restoreGrants(session),
      interactions: this.interactions,
      audit: (customType, data) => this.appendAudit(sessionId, customType, data),
      alwaysPath,
      ...(cwd ? { cwd } : {}),
      readableRoots: resources.readableRoots,
    };
    return { permission, resources };
  }

  /**
   * 写审计记录。命令运行中先入队、命令结束时顺序写入：运行中直接写会与 harness 自身的写入
   * 或另一条审计并发，SQLite 会话存储会拒绝。没有命令时丢弃。
   */
  async appendAudit(sessionId: string, customType: string, data: unknown): Promise<void> {
    const slot = this.slots.get(sessionId);
    if (!slot) return;
    if (slot.phase === "idle") {
      await slot.session.appendCustomEntry(customType, data);
      return;
    }
    slot.audit.push({ customType, data });
  }

  private async flushAudit(slot: HarnessSlot): Promise<void> {
    for (const { customType, data } of slot.audit.splice(0)) {
      try {
        await slot.session.appendCustomEntry(customType, data);
      } catch (error) {
        console.error("audit write failed", { customType, error });
      }
    }
  }

  /** 该命令是否因预算宽限用尽而被中止（结局 `budget_exceeded`）。 */
  abortedByBudget(sessionId: string, commandId: string): boolean {
    const slot = this.slots.get(sessionId);
    return slot?.commandId === commandId && slot.budget?.abortedByBudget === true;
  }

  /** 命令结束时由命令服务调用；命令未能启动时回合数为 0。 */
  emitRunSettled(sessionId: string, commandId: string, outcome: RunOutcome): void {
    const slot = this.slots.get(sessionId);
    const stats = slot?.commandId === commandId ? slot.stats : undefined;
    this.emit(sessionId, {
      event: "run.settled",
      data: {
        session_id: sessionId,
        command_id: commandId,
        outcome,
        budget: {
          turns: stats?.turns ?? 0,
          elapsed_ms: slot?.commandId === commandId && slot.budget ? slot.budget.elapsedMs() : stats ? Date.now() - stats.startedAt : 0,
          exhausted: slot?.commandId === commandId ? slot.budget?.exhausted ?? false : false,
        },
      },
    });
  }

  private emit(
    sessionId: string,
    event: Exclude<TransportEvent, { event: "snapshot" }>,
  ): void {
    for (const listener of this.listeners.get(sessionId) ?? []) listener(event);
  }
}
