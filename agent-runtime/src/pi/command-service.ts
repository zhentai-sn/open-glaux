import { createHash } from "node:crypto";

import { contentText } from "@earendil-works/pi-ai";

import type {
  SessionView,
  TransportCommand,
} from "../contracts.js";
import { RuntimeError } from "../errors.js";
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
            assertAssistantSuccess(await harness.prompt(command.content.trim()));
            await this.sessions.touchTitleFromFirstMessage(
              sessionId,
              command.content,
            );
            return;
          }
          await regenerateLatest(harness, activeSession);
        },
        {
          permissionMode: current.permission_mode,
          ...(command.type === "prompt" && command.viewer ? { viewer: command.viewer } : {}),
        },
      );
      void completion.then(
        () => this.settle(sessionId, command, digest, "completed"),
        (error: unknown) => {
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
    result: "completed" | "aborted" | "failed",
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

function commandDigest(
  command: Exclude<TransportCommand, { type: "abort" }>,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        type: command.type,
        content: "content" in command ? command.content : null,
      }),
    )
    .digest("hex");
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
  const user = messageEntries.at(-2);
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
  if (!prompt || !oldLeafId) {
    throw new RuntimeError(
      "message_not_regenerable",
      "The latest assistant message cannot be regenerated.",
      409,
    );
  }

  try {
    if (user.parentId === null) await session.moveTo(null);
    else await harness.navigateTree(user.parentId, { summarize: false });
    assertAssistantSuccess(await harness.prompt(prompt));
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
    throw new RuntimeError(
      "provider_unreachable",
      "The model provider could not complete the request.",
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
