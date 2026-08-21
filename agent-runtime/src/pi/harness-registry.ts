import { randomUUID } from "node:crypto";

import {
  AgentHarness,
  DEFAULT_COMPACTION_SETTINGS,
  estimateContextTokens,
  shouldCompact,
  type AgentHarnessEvent,
  type AgentHarnessTool,
  type Session,
} from "@earendil-works/pi-agent-core";
import type { Model, Models } from "@earendil-works/pi-ai";

import type {
  ConnectionInput,
  PermissionMode,
  SessionPhase,
  TransportEvent,
  ViewerContext,
} from "../contracts.js";
import { RuntimeError } from "../errors.js";
import type { SessionService } from "./session-service.js";
import {
  createModelRuntime,
  type ModelRuntime,
} from "./model-runtime.js";
import { CONSULT_ATLAS_TOOL_NAME, createConsultAtlasTool } from "./tools/consult-atlas.js";
import { createRunTaskTool } from "./tools/run-task.js";

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
}

export type HarnessTool = AgentHarnessTool<undefined>;

export interface HarnessToolFactory {
  (options: HarnessToolContext): HarnessTool[];
}

/**
 * 缺省工具集：`observe` 模式下无工具（SDD 02 §7.3——只能文字描述）；其它模式挂 `run_task`。
 * 更细的逐次批准门控随 SDD 02 的 beforeToolCall 落地。
 *
 * `consult_atlas` 只在连接声明 `vision: true` 时挂上（SDD 03 D-21）：无视觉的模型收到的图会被
 * pi-ai 静默换成"image omitted"占位，挂了它只会让模型以为自己翻过图谱。
 */
export const defaultToolFactory: HarnessToolFactory = ({
  viewer,
  permissionMode,
  connection,
  runtime,
}) => {
  if (permissionMode === "observe") return [];
  const tools = [createRunTaskTool({ ...(viewer ? { viewer } : {}) }) as HarnessTool];
  if (connection?.vision && runtime) {
    tools.push(
      createConsultAtlasTool({
        runtime,
        connection,
        ...(viewer ? { viewer } : {}),
      }) as HarnessTool,
    );
  }
  return tools;
};

const SYSTEM_PROMPT =
  "You are Glaux's built-in reference assistant for biomedical image insight. " +
  "Glaux is the environment you act in: it decodes images, runs calibrated segmentation and measurement, " +
  "and verifies results. When the user asks to measure, segment, or analyse the current image, call the " +
  "run_task tool instead of guessing numbers; report the returned metrics faithfully with units. " +
  "If the request is out of Glaux's registered tasks, say so plainly rather than inventing a result.";

const ATLAS_PROMPT =
  " Glaux also keeps an Atlas: a human-curated casebook of reference images. Consult it with the " +
  "consult_atlas tool before judging what a finding or structure looks like, and cite the case ids you used.";

function systemPromptFor(viewer: ViewerContext | undefined, atlas = false): string {
  const head = atlas ? `${SYSTEM_PROMPT}${ATLAS_PROMPT}` : SYSTEM_PROMPT;
  if (!viewer?.image_id) return `${head} No image is currently open in the viewer.`;
  const parts = [`image_id=${viewer.image_id}`];
  if (viewer.task) parts.push(`task=${viewer.task}`);
  if (viewer.modality) parts.push(`modality=${viewer.modality}`);
  if (viewer.method) parts.push(`method=${viewer.method}`);
  return `${head} Viewer context: ${parts.join(", ")}.`;
}

interface HarnessSlot {
  session: Session;
  harness: AgentHarness;
  phase: SessionPhase;
  commandId: string;
  disposeCredential: () => void;
  unsubscribeHarness: () => void;
  completion: Promise<void>;
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

    const session = await this.sessions.openSession(sessionId);
    const runtime = this.runtimeFactory(connection);
    const tools = this.toolFactory({ ...options, connection, runtime });
    const harness = new AgentHarness({
      session,
      models: runtime.models,
      model: runtime.model,
      systemPrompt: systemPromptFor(
        options.viewer,
        tools.some((tool) => tool.name === CONSULT_ATLAS_TOOL_NAME),
      ),
      tools,
    });
    const unsubscribeHarness = harness.subscribe((event) => {
      this.emitPiEvent(sessionId, commandId, event);
    });
    const slot: HarnessSlot = {
      session,
      harness,
      phase: "running",
      commandId,
      disposeCredential: runtime.disposeCredential,
      unsubscribeHarness,
      completion: Promise.resolve(),
    };
    this.slots.set(sessionId, slot);

    slot.completion = (async () => {
      try {
        await this.compactIfNeeded(slot, runtime.models, runtime.model);
        slot.phase = "running";
        await operation(harness, session);
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

  private emitPiEvent(
    sessionId: string,
    commandId: string,
    event: AgentHarnessEvent,
  ): void {
    this.emit(sessionId, {
      event: "pi.event",
      data: { session_id: sessionId, command_id: commandId, event },
    });
  }

  private emit(
    sessionId: string,
    event: Exclude<TransportEvent, { event: "snapshot" }>,
  ): void {
    for (const listener of this.listeners.get(sessionId) ?? []) listener(event);
  }
}
