/**
 * SDD 15 §7.8：预算插件。收尾状态下拦截一切工具调用，恒排在插件登记表最前。
 * 收尾回合另在发给模型的上下文末尾追加作答要求（只改请求，不写会话）：预算可能在回合开始时就判定用尽，
 * 此时模型还没见过拦截理由，又被禁止调用工具（wind-down.ts），会把想做的调用写成文字。
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";

import type { GlauxPlugin } from "../plugins/types.js";

export const budgetPlugin: GlauxPlugin = {
  name: "budget",
  applies: () => true,
  hooks: {
    async tool_call(_event, ctx) {
      const budget = ctx.budget;
      if (!budget?.check()) return undefined;
      return { block: true, reason: budget.blockReason() };
    },
    async context(messages, ctx) {
      const budget = ctx.budget;
      if (!budget?.exhausted) return messages;
      const notice: AgentMessage = { role: "user", content: [{ type: "text", text: `[Glaux] ${budget.blockReason()}` }], timestamp: Date.now() };
      return [...messages, notice];
    },
  },
};
