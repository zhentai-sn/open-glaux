/** SDD 15 §7.7：向用户提问。effect 为 `read`，所有权限模式可用。 */
import { ASK_USER_TOOL_NAME, createAskUserTool } from "../interaction/ask-user.js";
import type { HarnessTool } from "../pi/harness-registry.js";
import type { GlauxPlugin } from "./types.js";

const ASK_USER_PROMPT =
  " If you cannot continue without information only the user has, or several reasonable directions exist, " +
  "ask with ask_user instead of guessing; offer short options when the choices are clear.";

export const interactionPlugin: GlauxPlugin = {
  name: "interaction",
  applies: (ctx) => !!ctx.interactions && !!ctx.run,
  tools: [
    {
      name: ASK_USER_TOOL_NAME, effect: "read", requires: {}, supports: () => true,
      create: (ctx) => createAskUserTool({
        table: ctx.interactions!, sessionId: ctx.run!.sessionId, commandId: ctx.run!.commandId,
        ...(ctx.subagent ? { origin: { subagent: ctx.subagent.description } } : {}),
        ...(ctx.subagent?.toolCallId ? { anchorToolCallId: ctx.subagent.toolCallId } : {}),
      }) as HarnessTool,
      promptFragment: () => ASK_USER_PROMPT,
    },
  ],
};
