import {
  estimateContextTokens,
  type AgentMessage,
  type Session,
} from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import {
  createNodeSqliteFactory,
  SqliteSessionRepo,
  type SqliteSessionMetadata,
} from "@earendil-works/pi-storage-sqlite-node";

import type {
  CreateSessionInput,
  GlauxMetaRecord,
  PatchSessionInput,
  SessionListItem,
  SessionPhase,
  SessionStatus,
  SessionView,
  TranscriptMessage,
} from "../contracts.js";
import { RuntimeError } from "../errors.js";
import { toTranscript } from "../transport/transcript.js";
import { GlauxMetaRepo } from "../storage/glaux-meta-repo.js";
import { ATLAS_REFERENCED_DETAILS_KIND } from "./tools/consult-atlas.js";
import { ANNOTATION_PROPOSED_DETAILS_KIND } from "./tools/propose-annotation.js";
import { OBJECT_OPENED_DETAILS_KIND } from "./tools/open-file.js";

type ClosableStorage = { cleanup?: () => Promise<void> };

export interface SessionServiceOptions {
  workspaceDir: string;
  piDatabasePath: string;
  metaDatabasePath: string;
  phaseForSession?: (sessionId: string) => SessionPhase;
}

export class SessionService {
  readonly env: NodeExecutionEnv;
  readonly piRepo: SqliteSessionRepo;
  readonly metaRepo: GlauxMetaRepo;
  private readonly phaseForSession: (sessionId: string) => SessionPhase;

  constructor(options: SessionServiceOptions) {
    this.env = new NodeExecutionEnv({ cwd: options.workspaceDir });
    this.piRepo = new SqliteSessionRepo({
      env: this.env,
      sqlite: createNodeSqliteFactory(),
      databasePath: options.piDatabasePath,
    });
    this.metaRepo = new GlauxMetaRepo(options.metaDatabasePath);
    this.phaseForSession = options.phaseForSession ?? (() => "idle");
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
    const messages = branch.flatMap((entry) =>
      entry.type === "message" ? visibleMessage(entry.message) : [],
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
      pending_interactions: [],
      warnings: [],
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
]);

/**
 * 会话视图里保留哪些消息。
 *
 * user / assistant 原样保留。`toolResult` 原本整条丢弃，卡片就只能靠实时事件、刷新即消失；
 * 带可呈现 details 的工具结果改为保留，但**剥掉 content**——图谱案例图是几百 KB 的 base64，
 * 前端只用 details 渲染卡片（案例图另经 `/atlas/exemplars/{id}/crop` 取），不必进快照。
 */
function visibleMessage(message: AgentMessage): TranscriptMessage[] {
  const transcript = toTranscript(message);
  if (!transcript) return [];
  if (transcript.role === "user" || transcript.role === "assistant") return [transcript];
  if (transcript.isError) return [];
  const kind = (transcript.details as { kind?: unknown } | undefined)?.kind;
  if (typeof kind !== "string" || !VIEWABLE_DETAILS_KINDS.has(kind)) return [];
  return [{ ...transcript, content: [] }];
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
