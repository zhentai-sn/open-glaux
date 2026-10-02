/** SDD 15 §7.8：预算插件。收尾状态下拦截一切工具调用，恒排在插件登记表最前。 */
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
  },
};
