/** SDD 15 §7.7：向用户提问。effect 为 `read`，所有权限模式可用。 */
import { ASK_USER_TOOL_NAME, ASK_USER_ZH, createAskUserTool } from "../interaction/ask-user.js";
import { langOf, localizeTool, type Bilingual } from "../i18n/prompt-lang.js";
import type { HarnessTool } from "../pi/harness-registry.js";
import type { GlauxPlugin } from "./types.js";

const ASK_USER_PROMPT: Bilingual = {
  en: " If you cannot continue without information only the user has, or several reasonable directions exist, " +
    "ask with ask_user instead of guessing; offer short options when the choices are clear.",
  zh: "如果缺少只有用户才知道的信息就无法继续，或者存在多个合理方向，用 ask_user 提问，不要猜；选择明确时给出简短选项。",
};

export const interactionPlugin: GlauxPlugin = {
  name: "interaction",
  applies: (ctx) => !!ctx.interactions && !!ctx.run,
  tools: [
    {
      name: ASK_USER_TOOL_NAME, effect: "read", requires: {}, supports: () => true,
      create: (ctx) => localizeTool(createAskUserTool({
        table: ctx.interactions!, sessionId: ctx.run!.sessionId, commandId: ctx.run!.commandId,
        ...(ctx.subagent ? { origin: { subagent: ctx.subagent.description } } : {}),
        ...(ctx.subagent?.toolCallId ? { anchorToolCallId: ctx.subagent.toolCallId } : {}),
      }), langOf(ctx), ASK_USER_ZH) as HarnessTool,
      promptFragment: (ctx) => ASK_USER_PROMPT[langOf(ctx)],
    },
  ],
};
