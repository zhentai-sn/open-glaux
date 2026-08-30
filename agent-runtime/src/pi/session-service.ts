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
  GlauxSessionMeta,
  PatchSessionInput,
  SessionListItem,
  SessionPhase,
  SessionStatus,
  SessionView,
} from "../contracts.js";
import { RuntimeError } from "../errors.js";
import { GlauxMetaRepo } from "../storage/glaux-meta-repo.js";
import { ATLAS_REFERENCED_DETAILS_KIND } from "./tools/consult-atlas.js";
import { ANNOTATION_PROPOSED_DETAILS_KIND } from "./tools/propose-annotation.js";

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

    if (existingMetadata) {
      const meta = this.requireMeta(input.session_id);
      if (
        meta.title !== requestedTitle ||
        meta.permission_mode !== requestedPermission
      ) {
        throw new RuntimeError(
          "idempotency_conflict",
          "Session id already exists with different creation parameters.",
          409,
        );
      }
      return { created: false, view: await this.getSession(input.session_id) };
    }

    const reusable = await this.findReusableEmptySession();
    if (reusable) {
      return { created: false, view: await this.getSession(reusable.session_id) };
    }

    const session = await this.piRepo.create({
      id: input.session_id,
      cwd: this.env.cwd,
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
    const views = await Promise.all(
      metas.map(async (meta) => {
        try {
          const { messages: _messages, ...item } = await this.getSession(meta.session_id);
          return item;
        } catch (error) {
          if (error instanceof RuntimeError && error.code === "session_not_found") {
            this.metaRepo.delete(meta.session_id);
            return undefined;
          }
          throw error;
        }
      }),
    );
    return views
      .filter((item): item is SessionListItem => item !== undefined)
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  }

  async getSession(sessionId: string): Promise<SessionView> {
    const metadata = await this.requirePiMetadata(sessionId);
    const session = await this.piRepo.open(metadata);
    try {
      const meta = this.requireMeta(sessionId);
      return await this.toView(session, meta);
    } finally {
      await this.closeSession(session);
    }
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

  private async toView(
    session: Session<SqliteSessionMetadata>,
    meta: GlauxSessionMeta,
  ): Promise<SessionView> {
    const branch = await session.getBranch();
    const context = await session.buildContext();
    const messages = branch.flatMap((entry) =>
      entry.type === "message" ? visibleMessage(entry.message) : [],
    );
    const updatedAt = branch.reduce(
      (latest, entry) => (entry.timestamp > latest ? entry.timestamp : latest),
      meta.updated_at,
    );
    const estimate = estimateContextTokens(context.messages);
    return {
      ...meta,
      provider: context.model?.provider ?? null,
      model: context.model?.modelId ?? null,
      phase: this.phaseForSession(meta.session_id),
      messages,
      context_usage: { tokens: estimate.tokens },
      updated_at: updatedAt,
    };
  }

  private requireMeta(sessionId: string): GlauxSessionMeta {
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

  private async findReusableEmptySession(): Promise<GlauxSessionMeta | undefined> {
    for (const meta of this.metaRepo.list("active")) {
      const metadata = await this.findPiMetadata(meta.session_id);
      if (!metadata) continue;
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

/**
 * 工具结果里需要随会话历史持久呈现的卡片。`glaux.task_output` 等纯 Viewer 结果靠实时
 * 事件写回，不进每次快照；建议标注 details 体积小且承载确认/驳回入口，必须保留。
 */
const VIEWABLE_DETAILS_KINDS = new Set([
  ATLAS_REFERENCED_DETAILS_KIND,
  ANNOTATION_PROPOSED_DETAILS_KIND,
]);

/**
 * 会话视图里保留哪些消息。
 *
 * user / assistant 原样保留。`toolResult` 原本整条丢弃，卡片就只能靠实时事件、刷新即消失；
 * 带可呈现 details 的工具结果改为保留，但**剥掉 content**——图谱案例图是几百 KB 的 base64，
 * 前端只用 details 渲染卡片（案例图另经 `/atlas/exemplars/{id}/crop` 取），不必进快照。
 */
function visibleMessage(message: AgentMessage): AgentMessage[] {
  if (message.role === "user" || message.role === "assistant") return [message];
  if (message.role !== "toolResult" || message.isError) return [];
  const kind = (message.details as { kind?: unknown } | undefined)?.kind;
  if (typeof kind !== "string" || !VIEWABLE_DETAILS_KINDS.has(kind)) return [];
  return [{ ...message, content: [] }];
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
