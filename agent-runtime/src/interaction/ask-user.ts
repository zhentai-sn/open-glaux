/** SDD 15 §7.7：`ask_user` 向用户提问并按回答继续。 */
import { Type, type Static, type TextContent } from "@earendil-works/pi-ai";
import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";

import type { InteractionTable } from "./table.js";

export const ASK_USER_TOOL_NAME = "ask_user";

const AskParams = Type.Object({
  question: Type.String({ minLength: 1, maxLength: 500, description: "The question to show the user." }),
  options: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 80 }), {
    maxItems: 4,
    description: "Up to 4 short answer choices.",
  })),
  allow_free_text: Type.Optional(Type.Boolean({
    description: "Whether the user may type their own answer; defaults to true and is forced on when there are no options.",
  })),
});

export interface AskUserToolOptions {
  table: InteractionTable;
  sessionId: string;
  commandId: string;
  origin?: { subagent: string };
  /** 子智能体内：主对话中所属 `agent` 调用的标识；缺省用本次 `ask_user` 调用的标识。 */
  anchorToolCallId?: string;
}

function text(value: string): { content: TextContent[] } {
  return { content: [{ type: "text", text: value }] };
}

export function createAskUserTool(options: AskUserToolOptions): AgentHarnessTool<undefined, typeof AskParams> {
  return {
    name: ASK_USER_TOOL_NAME,
    label: "Ask the user",
    description:
      "Ask the user a question and wait for the answer. Use it only when you lack information needed to continue, " +
      "or when several reasonable directions exist. Do not use it to ask for permission; permissions are handled by the system.",
    parameters: AskParams,
    async execute(toolCallId, params: Static<typeof AskParams>, signal) {
      const choices = params.options ?? [];
      const onAbort = () => options.table.cancelCommand(options.sessionId, options.commandId);
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        const resolution = await options.table.create({
          session_id: options.sessionId,
          command_id: options.commandId,
          kind: "question",
          ...(options.origin ? { origin: options.origin } : {}),
          tool_call_id: options.anchorToolCallId ?? toolCallId,
          question: {
            question: params.question,
            options: choices,
            allow_free_text: choices.length === 0 ? true : (params.allow_free_text ?? true),
          },
        });
        if (resolution.outcome === "expired") return { ...text("The user did not reply."), details: { kind: "glaux.ask_user", outcome: "expired" } };
        if (resolution.outcome === "cancelled") return { ...text("The question was cancelled."), details: { kind: "glaux.ask_user", outcome: "cancelled" } };
        const reply = resolution.reply;
        const answer = reply?.kind === "question"
          ? (reply.option !== undefined ? choices[reply.option] ?? "" : reply.text ?? "")
          : "";
        return { ...text(`The user answered: ${answer}`), details: { kind: "glaux.ask_user", outcome: "answered", answer } };
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}
