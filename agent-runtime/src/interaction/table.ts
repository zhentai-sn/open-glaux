/**
 * SDD 15 §7.6：交互请求表。权限审批与 `ask_user` 提问共用一套挂起、回复、过期与取消机制。
 * 请求只在内存中登记；runtime 重启后丢失，命令结局按 SDD 00 记为未知。
 */
import { uuidv7 } from "@earendil-works/pi-agent-core";

import type { InteractionRequest } from "../contracts.js";
import { RuntimeError } from "../errors.js";

export type InteractionReply =
  | { kind: "permission"; decision: "once" | "session" | "always" | "deny"; reason?: string }
  | { kind: "question"; option?: number; text?: string };

export type InteractionOutcome = "answered" | "expired" | "cancelled";

export interface InteractionResolution {
  outcome: InteractionOutcome;
  reply?: InteractionReply;
  /** 从创建到结束的等待时长，预算计时扣除它（SDD 15 §7.8）。 */
  waited_ms: number;
}

export type InteractionEvent =
  | { event: "interaction.request"; data: InteractionRequest }
  | { event: "interaction.resolved"; data: { session_id: string; request_id: string; outcome: InteractionOutcome } };

export interface InteractionTableOptions {
  emit: (sessionId: string, event: InteractionEvent) => void;
  /** 请求结束时写审计记录；失败不影响结论。 */
  audit?: (sessionId: string, record: { request: InteractionRequest; outcome: InteractionOutcome; reply?: InteractionReply }) => Promise<void>;
  timeoutMs?: number;
  now?: () => number;
}

export type InteractionInput = Pick<InteractionRequest, "session_id" | "command_id" | "kind" | "permission" | "question">;

interface PendingEntry {
  request: InteractionRequest;
  createdAt: number;
  timer: ReturnType<typeof setTimeout>;
  settle: (resolution: InteractionResolution) => void;
}

interface ResolvedEntry {
  sessionId: string;
  outcome: InteractionOutcome;
  reply?: InteractionReply;
}

export const DEFAULT_INTERACTION_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_RESOLVED = 500;
const MAX_REASON = 500;
const MAX_ANSWER_TEXT = 2000;

export class InteractionTable {
  private readonly open = new Map<string, PendingEntry>();
  /** 已结束请求的结论，用于回复幂等；按插入顺序保留最近 MAX_RESOLVED 条。 */
  private readonly resolved = new Map<string, ResolvedEntry>();
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(private readonly options: InteractionTableOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_INTERACTION_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
  }

  /** 创建请求并挂起，直到回复、过期或取消。 */
  create(input: InteractionInput): Promise<InteractionResolution> {
    const createdAt = this.now();
    const request: InteractionRequest = {
      request_id: uuidv7(),
      session_id: input.session_id,
      command_id: input.command_id,
      kind: input.kind,
      created_at: new Date(createdAt).toISOString(),
      expires_at: new Date(createdAt + this.timeoutMs).toISOString(),
      ...(input.permission ? { permission: input.permission } : {}),
      ...(input.question ? { question: input.question } : {}),
    };
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.finish(request.request_id, "expired"), this.timeoutMs);
      timer.unref?.();
      this.open.set(request.request_id, { request, createdAt, timer, settle: resolve });
      this.options.emit(request.session_id, { event: "interaction.request", data: request });
    });
  }

  /** 回复端点（SDD 15 §9.4）：校验后结束请求；同一回复重复提交返回相同结果。 */
  reply(sessionId: string, requestId: string, reply: InteractionReply): { request_id: string; outcome: "answered" } {
    const entry = this.open.get(requestId);
    if (!entry || entry.request.session_id !== sessionId) {
      const done = this.resolved.get(requestId);
      if (!done || done.sessionId !== sessionId) {
        throw new RuntimeError("interaction_not_found", "Interaction request not found.", 404);
      }
      if (done.outcome === "answered" && JSON.stringify(done.reply) === JSON.stringify(reply)) {
        return { request_id: requestId, outcome: "answered" };
      }
      throw new RuntimeError("interaction_resolved", "Interaction request is already resolved.", 409);
    }
    validateReply(entry.request, reply);
    this.finish(requestId, "answered", reply);
    return { request_id: requestId, outcome: "answered" };
  }

  /** 命令中止时取消它的全部待决请求。 */
  cancelCommand(sessionId: string, commandId: string): void {
    for (const [id, entry] of [...this.open]) {
      if (entry.request.session_id === sessionId && entry.request.command_id === commandId) this.finish(id, "cancelled");
    }
  }

  pending(sessionId: string): InteractionRequest[] {
    return [...this.open.values()].filter((entry) => entry.request.session_id === sessionId).map((entry) => entry.request);
  }

  private finish(requestId: string, outcome: InteractionOutcome, reply?: InteractionReply): void {
    const entry = this.open.get(requestId);
    if (!entry) return;
    this.open.delete(requestId);
    clearTimeout(entry.timer);
    const sessionId = entry.request.session_id;
    this.remember(requestId, { sessionId, outcome, ...(reply ? { reply } : {}) });
    entry.settle({ outcome, ...(reply ? { reply } : {}), waited_ms: Math.max(0, this.now() - entry.createdAt) });
    this.options.emit(sessionId, { event: "interaction.resolved", data: { session_id: sessionId, request_id: requestId, outcome } });
    void this.options.audit?.(sessionId, { request: entry.request, outcome, ...(reply ? { reply } : {}) }).catch(() => undefined);
  }

  private remember(requestId: string, entry: ResolvedEntry): void {
    this.resolved.set(requestId, entry);
    if (this.resolved.size > MAX_RESOLVED) this.resolved.delete(this.resolved.keys().next().value!);
  }
}

function invalid(message: string): never {
  throw new RuntimeError("invalid_reply", message, 422);
}

export function validateReply(request: InteractionRequest, reply: InteractionReply): void {
  if (reply.kind !== request.kind) invalid("Reply kind does not match the request.");
  if (reply.kind === "permission") {
    const allowed = [...(request.permission?.grant_options ?? []), "deny"];
    if (!allowed.includes(reply.decision)) invalid("Decision is not offered for this request.");
    if (reply.reason !== undefined && (typeof reply.reason !== "string" || reply.reason.length > MAX_REASON)) {
      invalid(`Reason must be a string of at most ${MAX_REASON} characters.`);
    }
    return;
  }
  const question = request.question!;
  const hasOption = reply.option !== undefined;
  const hasText = reply.text !== undefined;
  if (hasOption === hasText) invalid("Reply with exactly one of option or text.");
  if (hasOption && (!Number.isInteger(reply.option) || reply.option! < 0 || reply.option! >= question.options.length)) {
    invalid("Option index is out of range.");
  }
  if (hasText) {
    if (!question.allow_free_text) invalid("Free text is not allowed for this question.");
    if (typeof reply.text !== "string" || !reply.text.trim() || reply.text.length > MAX_ANSWER_TEXT) {
      invalid(`Text must be non-empty and at most ${MAX_ANSWER_TEXT} characters.`);
    }
  }
}
