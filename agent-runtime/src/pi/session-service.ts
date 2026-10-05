import {
  estimateContextTokens,
  type AgentMessage,
  type Session,
} from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import {
  SqliteSessionRepo,
  type SqliteSessionMetadata,
} from "@earendil-works/pi-storage-sqlite-node";

import type {
  CreateSessionInput,
  GlauxMetaRecord,
  InteractionRequest,
  RuntimeWarning,
  PatchSessionInput,
  SessionListItem,
  SessionPhase,
  SessionStatus,
  SessionView,
  TranscriptBlock,
  TranscriptMessage,
} from "../contracts.js";
import { RuntimeError } from "../errors.js";
import { redactText } from "../security/redact.js";
import { toTranscript } from "../transport/transcript.js";
import { removeWorkspace } from "../workspace/cwd.js";
import { GlauxMetaRepo } from "../storage/glaux-meta-repo.js";
import { createSerializedSqliteFactory } from "../storage/serialized-sqlite.js";
import { ATLAS_REFERENCED_DETAILS_KIND } from "./tools/consult-atlas.js";
import { ANNOTATION_PROPOSED_DETAILS_KIND } from "./tools/propose-annotation.js";
import { OBJECT_OPENED_DETAILS_KIND } from "./tools/open-file.js";
import { FILE_READ_DETAILS_KIND } from "../plugins/files.js";
import { SUBAGENT_RUN_DETAILS_KIND } from "../subagents/run.js";
import { ANNOTATION_REVISED_DETAILS_KIND } from "./tools/revise-annotation.js";
import type { RequestContext, Trajectory } from "../contracts.js";
import { fullBranch } from "../trajectory/branch.js";
import { projectTrajectory } from "../trajectory/project.js";
import { requestContext } from "../trajectory/request.js";

type ClosableStorage = { cleanup?: () => Promise<void> };

/** 工具耗时审计记录：`{tool_call_id, duration_ms, waited_ms?, blocked?}`，命令结束时写入（SDD 15 §12）。 */

export const TOOL_TIMING_ENTRY = "glaux.tool.timing";

export interface SessionServiceOptions {
  workspaceDir: string;
  piDatabasePath: string;
  metaDatabasePath: string;
  phaseForSession?: (sessionId: string) => SessionPhase;
  /** 当前待决的交互请求（SDD 15 §9.7）；缺省视为没有。 */
  pendingInteractions?: (sessionId: string) => InteractionRequest[];
  /** 设置文件加载告警（SDD 15 §9.7）；缺省视为没有。 */
  warningsFor?: (sessionId: string) => RuntimeWarning[];
  /** 会话工作区根目录（SDD 16 §7.6）；删除会话时连带删除其工作区。缺省不删除任何目录。 */
  workspacesRoot?: string;
}

export class SessionService {
  readonly env: NodeExecutionEnv;
  readonly piRepo: SqliteSessionRepo;
  readonly metaRepo: GlauxMetaRepo;
  private readonly phaseForSession: (sessionId: string) => SessionPhase;
  private readonly pendingInteractions: (sessionId: string) => InteractionRequest[];
  private readonly warningsFor: (sessionId: string) => RuntimeWarning[];
  private readonly workspacesRoot: string | undefined;

  constructor(options: SessionServiceOptions) {
    this.env = new NodeExecutionEnv({ cwd: options.workspaceDir });
    this.piRepo = new SqliteSessionRepo({
      env: this.env,
      // 并发会话的写须串行，见 storage/serialized-sqlite.ts。
      sqlite: createSerializedSqliteFactory(),
      databasePath: options.piDatabasePath,
    });
    this.metaRepo = new GlauxMetaRepo(options.metaDatabasePath);
    this.phaseForSession = options.phaseForSession ?? (() => "idle");
    this.pendingInteractions = options.pendingInteractions ?? (() => []);
    this.warningsFor = options.warningsFor ?? (() => []);
    this.workspacesRoot = options.workspacesRoot;
  }

  async initialize(): Promise<void> {
    await this.piRepo.list();
  }

  async close(): Promise<void> {
    this.metaRepo.close();
    await this.env.cleanup();
  }

  async createSession(
    input: CreateSessionInput,
  ): Promise<{ created: boolean; view: SessionView }> {
    const existingMetadata = await this.findPiMetadata(input.session_id);
    const requestedTitle = normalizeTitle(input.title ?? "New conversation");
    const requestedPermission = input.permission_mode ?? "controlled";
    const requestedProjectId = input.project_id ?? null;

    if (existingMetadata) {
      const meta = this.requireMeta(input.session_id);
      if (
        meta.title !== requestedTitle ||
        meta.permission_mode !== requestedPermission ||
        sessionProjectId(existingMetadata) !== requestedProjectId
      ) {
        throw new RuntimeError(
          "idempotency_conflict",
          "Session id already exists with different creation parameters.",
          409,
        );
      }
      return { created: false, view: await this.getSession(input.session_id) };
    }

    const reusable = await this.findReusableEmptySession(requestedProjectId);
    if (reusable) {
      return { created: false, view: await this.getSession(reusable.session_id) };
    }

    // 项目绑定写入 Pi metadata，创建后不可改；cwd 不承载项目语义（SDD 13 §7.6、D-5）。
    // 未归属会话不写 metadata，与升级前的旧会话同形。
    const session = await this.piRepo.create({
      id: input.session_id,
      cwd: this.env.cwd,
      ...(requestedProjectId === null
        ? {}
        : { metadata: { [PROJECT_METADATA_KEY]: requestedProjectId } }),
    });
    try {
      this.metaRepo.create({
        sessionId: input.session_id,
        title: requestedTitle,
        permissionMode: requestedPermission,
      });
    } catch (error) {
      const metadata = await session.getMetadata();
      await this.closeSession(session);
      await this.piRepo.delete(metadata);
      throw error;
    }
    await this.closeSession(session);
    return { created: true, view: await this.getSession(input.session_id) };
  }

  async listSessions(status?: SessionStatus): Promise<SessionListItem[]> {
    const metas = this.metaRepo.list(status);
    // 全表 list 只调用一次，再按 id 与 companion 表合并。
    const piMetadata = await this.piMetadataById();
    const views = await Promise.all(
      metas.map(async (meta) => {
        const metadata = piMetadata.get(meta.session_id);
        if (!metadata) {
          // Pi 侧已不存在：顺手清掉孤立的 companion 行。
          this.metaRepo.delete(meta.session_id);
          return undefined;
        }
        const {
          messages: _messages, video_answers: _answers, video_observations: _observations,
          pending_interactions: _pending, warnings: _warnings, ...item
        } = await this.viewOf(metadata, meta);
        return item;
      }),
    );
    return views
      .filter((item): item is SessionListItem => item !== undefined)
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  }

  async getSession(sessionId: string): Promise<SessionView> {
    const metadata = await this.requirePiMetadata(sessionId);
    return this.viewOf(metadata, this.requireMeta(sessionId));
  }

  async patchSession(sessionId: string, patch: PatchSessionInput): Promise<SessionView> {
    if (patch.title !== undefined) normalizeTitle(patch.title);
    const metadata = await this.requirePiMetadata(sessionId);
    const session = await this.piRepo.open(metadata);
    try {
      if ((patch.provider === undefined) !== (patch.model === undefined)) {
        throw new RuntimeError(
          "invalid_request",
          "Provider and model must be updated together.",
          400,
        );
      }
      if (patch.provider !== undefined && patch.model !== undefined) {
        await session.appendModelChange(patch.provider, patch.model);
      }
      const meta = this.metaRepo.update(sessionId, {
        ...(patch.title === undefined ? {} : { title: normalizeTitle(patch.title) }),
        ...(patch.status === undefined ? {} : { status: patch.status }),
        ...(patch.permission_mode === undefined
          ? {}
          : { permission_mode: patch.permission_mode }),
      });
      return await this.toView(session, meta);
    } finally {
      await this.closeSession(session);
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    const metadata = await this.requirePiMetadata(sessionId);
    await this.piRepo.delete(metadata);
    this.metaRepo.delete(sessionId);
    if (this.workspacesRoot) {
      // SDD 16 §7.6 规则 2：工作区删除失败只记日志，不影响会话删除。
      await removeWorkspace(this.workspacesRoot, sessionId).catch((error: unknown) => {
        console.error("workspace removal failed", { sessionId, error });
      });
    }
  }

  /** SDD 21 §9.3：运行轨迹。 */
  async trajectory(sessionId: string): Promise<Trajectory> {
    const session = await this.openSession(sessionId);
    try {
      return projectTrajectory({
        sessionId,
        entries: await fullBranch(session),
        running: this.phaseForSession(sessionId) !== "idle",
      });
    } finally {
      await this.closeSession(session);
    }
  }

  /** SDD 21 §9.4：某次模型调用实际发送的消息。 */
  async requestContext(sessionId: string, itemId: string): Promise<RequestContext> {
    const session = await this.openSession(sessionId);
    try {
      return await requestContext(session, await fullBranch(session), itemId);
    } finally {
      await this.closeSession(session);
    }
  }

  async openSession(sessionId: string): Promise<Session<SqliteSessionMetadata>> {
    return this.piRepo.open(await this.requirePiMetadata(sessionId));
  }

  async touchTitleFromFirstMessage(sessionId: string, content: string): Promise<void> {
    const meta = this.requireMeta(sessionId);
    if (meta.title !== "New conversation") return;
    const title = titleFromContent(content);
    // 纯图像消息（content 为空，SDD 00 D-021）不命名会话：留在 "New conversation"，
    // 让下一条带文字的消息来定标题，而不是把标题钉成空串。
    if (!title) return;
    this.metaRepo.update(sessionId, { title });
  }

  async closeSession(session: Session): Promise<void> {
    await (session.getStorage() as ClosableStorage).cleanup?.();
  }

  private async viewOf(
    metadata: SqliteSessionMetadata,
    meta: GlauxMetaRecord,
  ): Promise<SessionView> {
    const session = await this.piRepo.open(metadata);
    try {
      return await this.toView(session, meta);
    } finally {
      await this.closeSession(session);
    }
  }

  private async toView(
    session: Session<SqliteSessionMetadata>,
    meta: GlauxMetaRecord,
  ): Promise<SessionView> {
    const projectId = sessionProjectId(await session.getMetadata());
    const branch = await session.getBranch();
    const context = await session.buildContext();
    // 同一标识可能跨回合复用（部分 OpenAI 兼容端点），耗时按记录顺序逐个对应工具结果
    const durations = new Map<string, ToolTiming[]>();
    for (const entry of branch) {
      if (entry.type !== "custom" || entry.customType !== TOOL_TIMING_ENTRY) continue;
      const data = entry.data as { tool_call_id?: unknown; duration_ms?: unknown; waited_ms?: unknown; blocked?: unknown };
      if (typeof data?.tool_call_id !== "string" || typeof data.duration_ms !== "number") continue;
      const waited = typeof data.waited_ms === "number" ? data.waited_ms : 0;
      const timing = { duration_ms: data.duration_ms, waited_ms: waited, blocked: data.blocked === true };
      durations.set(data.tool_call_id, [...(durations.get(data.tool_call_id) ?? []), timing]);
    }
    const messages = branch.flatMap((entry) =>
      entry.type === "message" ? visibleMessage(entry.message, durations) : [],
    );
    const videoAnswers = branch.flatMap((entry) => {
      if (entry.type !== "custom" || entry.customType !== "glaux.video.answer") return [];
      const data = entry.data as { command_id?: unknown; answer?: unknown };
      return typeof data?.command_id === "string" && data.answer && typeof data.answer === "object"
        ? [{ command_id: data.command_id, answer: data.answer as import("../contracts.js").VideoAnswer }]
        : [];
    });
    const videoObservations = branch.flatMap((entry) => {
      if (entry.type !== "custom" || entry.customType !== "glaux.video.observation") return [];
      const data = entry.data as { observation_id?: unknown };
      return typeof data?.observation_id === "string"
        ? [data as import("../contracts.js").ClipObservation]
        : [];
    });
    const updatedAt = branch.reduce(
      (latest, entry) => (entry.timestamp > latest ? entry.timestamp : latest),
      meta.updated_at,
    );
    const estimate = estimateContextTokens(context.messages);
    return {
      ...meta,
      project_id: projectId,
      provider: context.model?.provider ?? null,
      model: context.model?.modelId ?? null,
      phase: this.phaseForSession(meta.session_id),
      messages,
      video_answers: videoAnswers,
      video_observations: videoObservations,
      context_usage: { tokens: estimate.tokens },
      pending_interactions: this.pendingInteractions(meta.session_id),
      warnings: this.warningsFor(meta.session_id),
      updated_at: updatedAt,
    };
  }

  private requireMeta(sessionId: string): GlauxMetaRecord {
    const meta = this.metaRepo.get(sessionId);
    if (!meta) throw new RuntimeError("session_not_found", "Session not found.", 404);
    return meta;
  }

  private async requirePiMetadata(sessionId: string): Promise<SqliteSessionMetadata> {
    const metadata = await this.findPiMetadata(sessionId);
    if (!metadata) {
      throw new RuntimeError("session_not_found", "Session not found.", 404);
    }
    return metadata;
  }

  private async findPiMetadata(
    sessionId: string,
  ): Promise<SqliteSessionMetadata | undefined> {
    return (await this.piRepo.list()).find((item) => item.id === sessionId);
  }

  private async piMetadataById(): Promise<Map<string, SqliteSessionMetadata>> {
    return new Map((await this.piRepo.list()).map((item) => [item.id, item]));
  }

  /** 空会话复用按项目区分：同一 `project_id`（含 `null`）下最多一个（SDD 13 §7.6 规则 3）。 */
  private async findReusableEmptySession(
    projectId: string | null,
  ): Promise<GlauxMetaRecord | undefined> {
    const piMetadata = await this.piMetadataById();
    for (const meta of this.metaRepo.list("active")) {
      const metadata = piMetadata.get(meta.session_id);
      if (!metadata || sessionProjectId(metadata) !== projectId) continue;
      const session = await this.piRepo.open(metadata);
      try {
        const hasMessage = (await session.getEntries()).some(
          (entry) => entry.type === "message",
        );
        if (!hasMessage) return meta;
      } finally {
        await this.closeSession(session);
      }
    }
    return undefined;
  }
}

/** Pi 会话 `metadata` 中承载项目绑定的键（SDD 13 §9.5）。 */
export const PROJECT_METADATA_KEY = "glaux_project_id";

/** 会话绑定的项目；升级前的旧会话与未归属会话没有该键，返回 `null`。 */
export function sessionProjectId(metadata: SqliteSessionMetadata): string | null {
  const value = metadata.metadata?.[PROJECT_METADATA_KEY];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * 工具结果里需要随会话历史持久呈现的卡片。`glaux.task_output` 等纯 Viewer 结果靠实时
 * 事件写回，不进每次快照；建议标注 details 体积小且承载确认/驳回入口，必须保留。
 */
const VIEWABLE_DETAILS_KINDS = new Set([
  ATLAS_REFERENCED_DETAILS_KIND,
  ANNOTATION_PROPOSED_DETAILS_KIND,
  // SDD 13 D-18：对象卡片承载「在舞台打开」入口，切换会话后须随快照恢复。
  OBJECT_OPENED_DETAILS_KIND,
  // SDD 14 §12：读取卡片随快照保留（此前遗漏）。
  FILE_READ_DETAILS_KIND,
  // SDD 18 §7.3：子智能体卡片（最终回复与过程）随快照保留。
  SUBAGENT_RUN_DETAILS_KIND,
  // SDD 22 §5.1：修订卡片随快照保留。
  ANNOTATION_REVISED_DETAILS_KIND,
]);

/** 快照里每个工具结果保留的输出文本上限（SDD 15 §9.6）。 */
export const MAX_TOOL_OUTPUT_TEXT = 2000;

/** 工具输出：只留文本块，合并后脱敏、截断；图像块不进快照（图谱案例图是几百 KB 的 base64）。 */
function toolOutput(content: TranscriptBlock[]): TranscriptBlock[] {
  const text = redactText(content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n"));
  if (!text) return [];
  return [{ type: "text", text: text.length > MAX_TOOL_OUTPUT_TEXT ? `${text.slice(0, MAX_TOOL_OUTPUT_TEXT)}…` : text }];
}

/**
 * 会话视图里保留哪些消息。
 *
 * user / assistant 原样保留。`toolResult` 全部保留，供对话流展示工具的输出与耗时
 * （SDD 15 §5.1）：content 只留截断后的文本；details 只在可呈现卡片时保留——失败的结果
 * 不呈现卡片，子智能体例外（SDD 18 §7.3 规则 4）。
 */
interface ToolTiming {
  duration_ms: number;
  waited_ms: number;
  blocked: boolean;
}

function visibleMessage(message: AgentMessage, durations: Map<string, ToolTiming[]>): TranscriptMessage[] {
  const transcript = toTranscript(message);
  if (!transcript) return [];
  if (transcript.role === "user" || transcript.role === "assistant") return [transcript];
  const kind = (transcript.details as { kind?: unknown } | undefined)?.kind;
  const card = typeof kind === "string" && VIEWABLE_DETAILS_KINDS.has(kind)
    && (!transcript.isError || kind === SUBAGENT_RUN_DETAILS_KIND);
  const timing = durations.get(transcript.toolCallId)?.shift();
  return [{
    role: "toolResult",
    toolCallId: transcript.toolCallId,
    toolName: transcript.toolName,
    isError: transcript.isError,
    content: toolOutput(transcript.content),
    ...(card ? { details: transcript.details } : {}),
    ...(timing ? { duration_ms: timing.duration_ms } : {}),
    ...(timing?.waited_ms ? { waited_ms: timing.waited_ms } : {}),
    ...(timing?.blocked ? { blocked: true as const } : {}),
  }];
}

export function normalizeTitle(title: string): string {
  const normalized = title.replace(/\s+/gu, " ").trim();
  const length = [...normalized].length;
  if (length < 1 || length > 100) {
    throw new RuntimeError(
      "invalid_request",
      "Session title must contain 1 to 100 characters.",
      400,
    );
  }
  return normalized;
}

export function titleFromContent(content: string): string {
  return [...content.replace(/\s+/gu, " ").trim()].slice(0, 30).join("");
}
