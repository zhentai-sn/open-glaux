import { createHash } from "node:crypto";

import { parseCommandArgs } from "@earendil-works/pi-agent-core";
import { contentText } from "@earendil-works/pi-ai";
import type { ImageContent } from "@earendil-works/pi-ai";

import type {
  PromptImage,
  RunOutcome,
  SessionView,
  TransportCommand,
} from "../contracts.js";
import { RuntimeError } from "../errors.js";
import { redactText } from "../security/redact.js";
import type { HarnessRegistry } from "./harness-registry.js";
import { validateConnectionInput } from "./model-runtime.js";
import type { SessionService } from "./session-service.js";

interface CommandReceipt {
  command_id: string;
  command_type: "prompt" | "regenerate";
  digest: string;
  result?: string;
  code?: string;
}

export class CommandService {
  private readonly activeCommands = new Map<string, string>();

  constructor(
    private readonly sessions: SessionService,
    private readonly registry: HarnessRegistry,
  ) {}

  async accept(sessionId: string, command: TransportCommand): Promise<SessionView> {
    const current = await this.sessions.getSession(sessionId);

    if (command.type === "abort") {
      await this.registry.abort(sessionId);
      return this.sessions.getSession(sessionId);
    }
    if (current.status === "archived") {
      throw new RuntimeError(
        "session_archived",
        "Archived sessions are read-only.",
        409,
      );
    }
    validateConnectionInput(command.connection);
    if (this.registry.getPhase(sessionId) !== "idle") {
      const activeCommand = this.activeCommands.get(sessionId);
      if (activeCommand === command.command_id) return current;
      throw new RuntimeError("session_busy", "Session is already generating.", 409);
    }

    const digest = commandDigest(command);
    const receipt = await this.findReceipt(sessionId, command.command_id);
    if (receipt.accepted) {
      if (receipt.accepted.digest !== digest) {
        throw new RuntimeError(
          "idempotency_conflict",
          "Command id was already used for different content.",
          409,
        );
      }
      if (this.activeCommands.get(sessionId) === command.command_id) return current;
      if (receipt.settled) return current;
      throw new RuntimeError(
        "command_outcome_unknown",
        "The previous command outcome is unknown after Runtime restart.",
        409,
      );
    }

    const session = await this.sessions.openSession(sessionId);
    try {
      await session.appendCustomEntry("glaux.command.accepted", {
        command_id: command.command_id,
        command_type: command.type,
        digest,
      } satisfies CommandReceipt);
    } finally {
      await this.sessions.closeSession(session);
    }

    this.activeCommands.set(sessionId, command.command_id);
    try {
      const { completion } = await this.registry.start(
        sessionId,
        command.command_id,
        command.connection,
        async (harness, activeSession) => {
          if (command.type === "prompt") {
            const extra = command.content.trim();
            // 标题在调用模型前写入：命令中途中止或失败时会话也有名字；只写 Glaux 元数据，不与 Pi 会话写入并发。
            // SDD 17 §7.4：显式调用 Skill 或模板时标题取「/名称 附加内容」。
            await this.sessions.touchTitleFromFirstMessage(
              sessionId,
              command.skill !== undefined
                ? `/${command.skill} ${extra}`.trim()
                : command.template !== undefined
                  ? `/${command.template.name} ${command.template.args}`.trim()
                  : command.content,
            );
            if (command.skill !== undefined) {
              assertAssistantSuccess(await harness.skill(command.skill, extra || undefined));
              return;
            }
            if (command.template !== undefined) {
              assertAssistantSuccess(await harness.promptFromTemplate(command.template.name, parseCommandArgs(command.template.args)));
              return;
            }
            const images = toImageContent(command.images);
            assertAssistantSuccess(
              await harness.prompt(
                extra,
                images.length ? { images } : undefined,
              ),
            );
            return;
          }
          await regenerateLatest(harness, activeSession);
        },
        {
          permissionMode: current.permission_mode,
          ...(command.viewer ? { viewer: command.viewer } : {}),
          ...(command.lang ? { lang: command.lang } : {}),
          ...(command.type === "prompt" && (command.skill !== undefined || command.template !== undefined)
            ? { requires: { ...(command.skill !== undefined ? { skill: command.skill } : {}), ...(command.template ? { template: command.template.name } : {}) } }
            : {}),
        },
      );
      void completion.then(
        () => this.settle(sessionId, command, digest, "completed"),
        (error: unknown) => {
          // 预算宽限用尽的中止不是错误：结局记为 budget_exceeded，由 run.settled 告知前端（SDD 15 §7.8）。
          if (this.registry.abortedByBudget(sessionId, command.command_id)) {
            return this.settle(sessionId, command, digest, "budget_exceeded", "budget_exceeded");
          }
          const runtimeError = mapRuntimeError(error);
          this.registry.emitAdapterError(sessionId, command.command_id, runtimeError);
          return this.settle(
            sessionId,
            command,
            digest,
            runtimeError.code === "provider_aborted" ? "aborted" : "failed",
            runtimeError.code,
          );
        },
      );
    } catch (error) {
      this.activeCommands.delete(sessionId);
      await this.settle(
        sessionId,
        command,
        digest,
        "failed",
        mapRuntimeError(error).code,
      );
      throw error;
    }

    return this.sessions.getSession(sessionId);
  }

  private async settle(
    sessionId: string,
    command: Exclude<TransportCommand, { type: "abort" }>,
    digest: string,
    result: RunOutcome,
    code?: string,
  ): Promise<void> {
    const session = await this.sessions.openSession(sessionId);
    try {
      await session.appendCustomEntry("glaux.command.settled", {
        command_id: command.command_id,
        command_type: command.type,
        digest,
        result,
        ...(code ? { code } : {}),
      } satisfies CommandReceipt);
    } finally {
      await this.sessions.closeSession(session);
      if (this.activeCommands.get(sessionId) === command.command_id) {
        this.activeCommands.delete(sessionId);
      }
    }
    // 结局落盘之后再通知前端，前端据此重新拉取快照（SDD 15 §9.5）。
    this.registry.emitRunSettled(sessionId, command.command_id, result);
  }

  private async findReceipt(
    sessionId: string,
    commandId: string,
  ): Promise<{ accepted?: CommandReceipt; settled?: CommandReceipt }> {
    const session = await this.sessions.openSession(sessionId);
    try {
      const entries = await session.getEntries();
      let accepted: CommandReceipt | undefined;
      let settled: CommandReceipt | undefined;
      for (const entry of entries) {
        if (entry.type !== "custom") continue;
        const data = asReceipt(entry.data);
        if (!data || data.command_id !== commandId) continue;
        if (entry.customType === "glaux.command.accepted") accepted = data;
        if (entry.customType === "glaux.command.settled") settled = data;
      }
      return {
        ...(accepted ? { accepted } : {}),
        ...(settled ? { settled } : {}),
      };
    } finally {
      await this.sessions.closeSession(session);
    }
  }
}

/** 导出供测试复用：摘要公式只有一处，不让测试再抄一份平行实现。 */
export function commandDigest(
  command: Exclude<TransportCommand, { type: "abort" }>,
): string {
  // 附件参与摘要（SDD 00 §10）：同一 command_id 换图必须判为 idempotency_conflict，
  // 而不是被当成同一条命令的网络重试。逐张取 sha256 而非塞入原文，避免摘要输入过大。
  const images =
    "images" in command && command.images
      ? command.images.map((image) => ({
          mime_type: image.mime_type,
          sha256: createHash("sha256").update(image.data).digest("hex"),
        }))
      : null;
  return createHash("sha256")
    .update(
      JSON.stringify({
        type: command.type,
        content: "content" in command ? command.content : null,
        images,
        // SDD 17 §10：显式调用参与摘要，同一 command_id 换 Skill 判为冲突。
        ...(command.type === "prompt" && command.skill !== undefined ? { skill: command.skill } : {}),
        ...(command.type === "prompt" && command.template !== undefined ? { template: command.template } : {}),
        // SDD 20 §10：语言出现时参与摘要；不出现时与实施前相同。
        ...(command.lang !== undefined ? { lang: command.lang } : {}),
      }),
    )
    .digest("hex");
}

/** 从一条已存 user 消息的 content 里取回图像块（regenerate 用）。 */
function imagesOf(content: unknown): ImageContent[] {
  if (!Array.isArray(content)) return [];
  return content.filter(
    (block): block is ImageContent =>
      Boolean(block) &&
      typeof block === "object" &&
      (block as { type?: unknown }).type === "image" &&
      typeof (block as { data?: unknown }).data === "string",
  );
}

/** PromptImage（传输形状）→ pi-ai `ImageContent`（模型形状）。 */
function toImageContent(images: PromptImage[] | undefined): ImageContent[] {
  return (images ?? []).map((image) => ({
    type: "image",
    data: image.data,
    mimeType: image.mime_type,
  }));
}

function asReceipt(data: unknown): CommandReceipt | undefined {
  if (!data || typeof data !== "object") return undefined;
  const value = data as Partial<CommandReceipt>;
  if (
    typeof value.command_id !== "string" ||
    (value.command_type !== "prompt" && value.command_type !== "regenerate") ||
    typeof value.digest !== "string"
  ) {
    return undefined;
  }
  return value as CommandReceipt;
}

async function regenerateLatest(
  harness: import("@earendil-works/pi-agent-core").AgentHarness,
  session: import("@earendil-works/pi-agent-core").Session,
): Promise<void> {
  const branch = await session.getBranch();
  const messageEntries = branch.filter((entry) => entry.type === "message");
  const assistant = messageEntries.at(-1);
  // 一次回答可能含多轮工具调用（user → assistant → toolResult → … → assistant），
  // 要重放的是这一轮回答起点的 user，而不是末条 assistant 的前一条消息。
  const user = messageEntries.findLast((entry) => entry.message.role === "user");
  if (
    !assistant ||
    assistant.message.role !== "assistant" ||
    !user ||
    user.message.role !== "user"
  ) {
    throw new RuntimeError(
      "message_not_regenerable",
      "The latest assistant message cannot be regenerated.",
      409,
    );
  }
  const oldLeafId = await session.getLeafId();
  const prompt = contentText(user.message.content).trim();
  // 重发要连图一起（SDD 00 §15.4b）：只 replay 文本会让带图的那一轮在新分支上退化成纯文本。
  const images = imagesOf(user.message.content);
  if ((!prompt && images.length === 0) || !oldLeafId) {
    throw new RuntimeError(
      "message_not_regenerable",
      "The latest assistant message cannot be regenerated.",
      409,
    );
  }

  try {
    if (user.parentId === null) await session.moveTo(null);
    else await harness.navigateTree(user.parentId, { summarize: false });
    assertAssistantSuccess(
      await harness.prompt(prompt, images.length ? { images } : undefined),
    );
  } catch (error) {
    await harness.navigateTree(oldLeafId, { summarize: false }).catch(() => undefined);
    throw error;
  }
}

function assertAssistantSuccess(
  message: import("@earendil-works/pi-ai").AssistantMessage,
): void {
  if (message.stopReason === "aborted") {
    throw new RuntimeError("provider_aborted", "Generation was stopped.", 409);
  }
  if (message.stopReason === "error") {
    // 带上 provider 自己的说法：只回通用文案会让"模型不支持图像"这类可诊断的失败
    // 变成无从下手的 provider_unreachable（G5 失败可见）。凭据经 redact 过滤。
    const detail = message.errorMessage?.trim();
    throw new RuntimeError(
      "provider_unreachable",
      detail
        ? `The model provider could not complete the request: ${redactText(detail)}`
        : "The model provider could not complete the request.",
      503,
    );
  }
}

function mapRuntimeError(error: unknown): RuntimeError {
  if (error instanceof RuntimeError) return error;
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes("abort")) {
      return new RuntimeError("provider_aborted", "Generation was stopped.", 409);
    }
    if (message.includes("auth") || message.includes("api key")) {
      return new RuntimeError(
        "provider_auth_failed",
        "Provider authentication failed.",
        401,
      );
    }
    if (message.includes("compact") || message.includes("context")) {
      return new RuntimeError(
        "context_overflow",
        "The conversation context is too long.",
        409,
      );
    }
  }
  return new RuntimeError(
    "provider_unreachable",
    "The model provider could not complete the request.",
    503,
  );
}
