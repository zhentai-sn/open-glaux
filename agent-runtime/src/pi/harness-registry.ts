import { chatEdition, CHAT_SYSTEM_PROMPT } from "../edition.js";
import { randomUUID } from "node:crypto";

import {
  AgentHarness,
  DEFAULT_COMPACTION_SETTINGS,
  estimateContextTokens,
  shouldCompact,
  type AgentHarnessTool,
  type Session,
} from "@earendil-works/pi-agent-core";
import type { Model, Models } from "@earendil-works/pi-ai";

import type {
  ConnectionInput,
  PermissionMode,
  RunOutcome,
  SessionPhase,
  TransportEvent,
  ViewerContext,
} from "../contracts.js";
import { RuntimeError } from "../errors.js";
import { sessionProjectId, type SessionService } from "./session-service.js";
import {
  createModelRuntime,
  type ModelRuntime,
} from "./model-runtime.js";
import { activePlugins, availableTools, promptFragments } from "../plugins/registry.js";
import { installHooks } from "../plugins/compose.js";
import { mapPiEvent } from "../transport/event-map.js";
import { PROJECT_GUARDED_TOOL_NAMES, ProjectScope, withProjectGuard } from "./tools/project-guard.js";
import { VideoTurn } from "./video-turn.js";

export interface HarnessRuntimeFactory {
  (connection: ConnectionInput): ModelRuntime;
}

/** 每次 start 的领域上下文——工具集据此构造（当前图 / 当前任务 / 权限模式）。 */
export interface HarnessStartOptions {
  viewer?: ViewerContext;
  permissionMode?: PermissionMode;
}

/** 工具工厂拿到的完整上下文：领域上下文 + 本次连接与其模型运行时（图谱检索需要向模型发图）。 */
export interface HarnessToolContext extends HarnessStartOptions {
  connection?: ConnectionInput;
  runtime?: ModelRuntime;
  videoTurn?: VideoTurn;
  /** 会话绑定的项目（SDD 13 §7.6），由 `start()` 从 Pi 会话 metadata 读出；未归属会话缺省。 */
  projectId?: string;
}

export type HarnessTool = AgentHarnessTool<undefined>;

export interface HarnessToolFactory {
  (options: HarnessToolContext): HarnessTool[];
}

/**
 * 缺省工具集：取插件登记表中本次可挂载的工具（SDD 15 §7.1）。
 * `observe` 模式只保留两个视频工具（SDD 02 §7.3、SDD 11）；
 * 作用于当前对象的工具经 `withProjectGuard` 在执行前做项目越界校验（SDD 13 §7.8 规则 4）。
 */
export const defaultToolFactory: HarnessToolFactory = (context) => {
  if (chatEdition()) return [];
  const providers = availableTools(context);
  // 一次 start 一个作用域：越界校验的查询结果只在本回合内缓存（SDD 13 §7.8 规则 4）。
  const scope = new ProjectScope({
    ...(context.projectId ? { projectId: context.projectId } : {}),
    ...(context.viewer ? { viewer: context.viewer } : {}),
  });
  return (context.permissionMode === "observe"
    ? providers.filter((provider) => provider.name === "observe_video_interval" || provider.name === "submit_video_answer")
    : providers).map((provider) => {
      const tool = provider.create(context);
      return PROJECT_GUARDED_TOOL_NAMES.has(tool.name) ? withProjectGuard(tool, scope) : tool;
    });
};

const SYSTEM_PROMPT =
  "You are Glaux's built-in reference assistant for image and video analysis: natural images and video, " +
  "microscopy and pathology, and medical imaging. For medical and pathology images your output supports research, " +
  "not clinical diagnosis. " +
  "Glaux is the environment you act in: it decodes images, runs calibrated segmentation and measurement, " +
  "and verifies results. When the user asks to measure, segment, or analyse the current image, call the " +
  "run_task tool instead of guessing numbers; report the returned metrics faithfully with units. " +
  "If the request is out of Glaux's registered tasks, say so plainly rather than inventing a result.";

export function systemPromptFor(
  viewer: ViewerContext | undefined,
  tools: HarnessTool[],
  context: HarnessToolContext,
  videoDescription?: { duration_ms: number; has_audio: boolean },
): string {
  const mounted = new Set(tools.map((tool) => tool.name));
  const head = SYSTEM_PROMPT + promptFragments(context, mounted);
  if (!viewer?.focus) return `${head} No image is currently open in the viewer.`;
  if (viewer.focus.kind === "video" && !context.videoTurn) {
    return `${head} The current connection does not support joint audio-video Q&A. Say so explicitly when asked about the video; ordinary conversation remains available.`;
  }
  const parts = [`object_id=${viewer.focus.object_id}`, `kind=${viewer.object?.kind ?? viewer.focus.kind}`];
  const index = Object.entries(viewer.focus.index).filter(([, value]) => value != null)
    .map(([axis, value]) => `${axis}:${value}`).join(",");
  if (index) parts.push(`index={${index}}`);
  const t = viewer.focus.index.t;
  const timeAxis = viewer.object?.axes.find((axis) => axis.name === "t" && axis.unit === "ms" && axis.spacing);
  if (t != null && timeAxis?.spacing) {
    parts.push(`current_frame_time_ms≈${Math.round(t * timeAxis.spacing)} (average frame period; view_current_image returns the exact source time)`);
  }
  if (viewer.task) parts.push(`task=${viewer.task}`);
  if (viewer.collection) parts.push(`collection=${viewer.collection}`);
  if (viewer.method) parts.push(`method=${viewer.method}`);
  if (videoDescription) parts.push(`duration_ms=${videoDescription.duration_ms}`, `has_audio=${videoDescription.has_audio}`);
  // 措辞刻意强调"目录标签"：这几个字段来自数据集与 UI 选择，不代表画面内容。
  // 早期版本只给这一行，模型便把标签当观察复述，用户看到的图与模型说的对不上。
  return (
    `${head} Viewer context (catalogue labels recorded by the dataset and the UI, ` +
    `not a description of what the image shows): ${parts.join(", ")}.`
  );
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
}

type TransportListener = (event: Exclude<TransportEvent, { event: "snapshot" }>) => void;

export class HarnessRegistry {
  private readonly slots = new Map<string, HarnessSlot>();
  private readonly listeners = new Map<string, Set<TransportListener>>();

  constructor(
    private readonly sessions: SessionService,
    private readonly runtimeFactory: HarnessRuntimeFactory = createModelRuntime,
    private readonly toolFactory: HarnessToolFactory = defaultToolFactory,
  ) {}

  getPhase(sessionId: string): SessionPhase {
    return this.slots.get(sessionId)?.phase ?? "idle";
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

    const runtime = this.runtimeFactory(connection);
    const session = await this.sessions.openSession(sessionId);
    const videoTurn = runtime.videoMedia && options.viewer?.focus?.kind === "video"
      ? new VideoTurn(options.viewer.focus.object_id, commandId, session, runtime.videoMedia,
          (answer) => this.emit(sessionId, { event: "video.answer", data: { session_id: sessionId, command_id: commandId, answer } }))
      : undefined;
    let videoDescription: { duration_ms: number; has_audio: boolean } | undefined;
    let projectId: string | null;
    try {
      // 项目绑定只存 Pi metadata（SDD 13 D-5）；浏览工具挂载与越界校验都以它为准。
      projectId = sessionProjectId(await session.getMetadata());
      videoDescription = videoTurn ? await videoTurn.describe() : undefined;
    } catch (error) {
      runtime.disposeCredential();
      await this.sessions.closeSession(session);
      throw error;
    }
    const toolContext: HarnessToolContext = {
      ...options,
      connection,
      runtime,
      ...(videoTurn ? { videoTurn } : {}),
      ...(projectId ? { projectId } : {}),
    };
    const tools = chatEdition() ? [] : this.toolFactory(toolContext);
    const harness = new AgentHarness({
      session,
      models: runtime.models,
      model: runtime.model,
      systemPrompt: chatEdition() ? CHAT_SYSTEM_PROMPT : systemPromptFor(options.viewer, tools, toolContext, videoDescription),
      tools,
    });
    // SDD 15 §7.2：每种钩子只注册一个组合后的 handler；chat 发行版不挂插件。
    const uninstallHooks = chatEdition() ? () => undefined : installHooks(harness, activePlugins(toolContext), {
      sessionId,
      commandId,
      ...(projectId ? { projectId } : {}),
      ...(options.viewer ? { viewer: options.viewer } : {}),
    });
    const stats = { turns: 0, startedAt: Date.now() };
    const unsubscribeEvents = harness.subscribe((event) => {
      if (event.type === "turn_start") stats.turns += 1;
      const mapped = mapPiEvent(sessionId, commandId, event);
      if (mapped) this.emit(sessionId, mapped);
    });
    const unsubscribeHarness = () => {
      unsubscribeEvents();
      uninstallHooks();
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
    };
    this.slots.set(sessionId, slot);

    slot.completion = (async () => {
      try {
        await this.compactIfNeeded(slot, runtime.models, runtime.model);
        slot.phase = "running";
        await operation(harness, session);
        await videoTurn?.finalize();
      } finally {
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
          elapsed_ms: stats ? Date.now() - stats.startedAt : 0,
          exhausted: false,
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
