/**
 * SDD 18 §7.1、§7.3：`agent` 工具把自包含的子任务交给子智能体，只取回其最终回复。
 * effect 为 `delegate`；子智能体内不挂载（嵌套深度 1）。
 */
import { Type, type Static } from "@earendil-works/pi-ai";
import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";

import type { HarnessTool, HarnessToolContext } from "../pi/harness-registry.js";
import { SUBAGENT_RUN_DETAILS_KIND, type SubagentResult } from "../subagents/run.js";
import type { GlauxPlugin } from "./types.js";

export const AGENT_TOOL_NAME = "agent";

const AgentParams = Type.Object({
  subagent_type: Type.String({ minLength: 1, description: "Name of the sub-agent definition to use." }),
  description: Type.String({ minLength: 3, maxLength: 80, description: "A short (3-10 word) summary of the task, shown to the user." }),
  prompt: Type.String({
    minLength: 1,
    description: "The complete task. The sub-agent cannot see this conversation, so include every fact, path and object id it needs.",
  }),
});

export interface SubagentRunDetails {
  kind: typeof SUBAGENT_RUN_DETAILS_KIND;
  subagent_type: string;
  description: string;
  outcome: SubagentResult["outcome"];
  turns: number;
  final: string;
  transcript: SubagentResult["transcript"];
}

const NOTE: Partial<Record<SubagentResult["outcome"], string>> = {
  budget_exceeded: "[The sub-agent ran out of its budget; the reply below may be incomplete.]",
  aborted: "[The sub-agent was stopped before finishing.]",
};

export function resultText(result: SubagentResult): string {
  if (result.outcome === "failed") return `The sub-agent failed: ${result.error ?? "unknown error"}.`;
  const body = result.final || "The sub-agent gave no reply.";
  const note = NOTE[result.outcome];
  return note ? `${note}\n\n${body}` : body;
}

function createAgentTool(ctx: HarnessToolContext): AgentHarnessTool<undefined, typeof AgentParams> {
  return {
    name: AGENT_TOOL_NAME,
    label: "Run a sub-agent",
    description:
      "Hand a self-contained multi-step task to a sub-agent with a fresh context. " +
      "Only its final reply comes back to you. Several calls in one turn run concurrently.",
    parameters: AgentParams,
    async execute(toolCallId, params: Static<typeof AgentParams>, signal) {
      const known = ctx.agents?.map((def) => def.name) ?? [];
      if (!known.includes(params.subagent_type)) {
        return {
          content: [{ type: "text", text: `Unknown sub-agent "${params.subagent_type}". Available: ${known.join(", ") || "none"}.` }],
          details: undefined,
        };
      }
      const result = await ctx.spawnSubagent!(params, { ...(signal ? { signal } : {}), toolCallId });
      const details: SubagentRunDetails = {
        kind: SUBAGENT_RUN_DETAILS_KIND,
        subagent_type: params.subagent_type,
        description: params.description,
        outcome: result.outcome,
        turns: result.turns,
        final: result.final,
        transcript: result.transcript,
      };
      return { content: [{ type: "text", text: resultText(result) }], details };
    },
  };
}

export const subagentsPlugin: GlauxPlugin = {
  name: "subagents",
  applies: (ctx) => !!ctx.spawnSubagent && !ctx.subagent && (ctx.agents?.length ?? 0) > 0,
  tools: [
    {
      name: AGENT_TOOL_NAME,
      effect: "delegate",
      requires: {},
      supports: () => true,
      create: (ctx) => createAgentTool(ctx) as HarnessTool,
      promptFragment: (ctx) =>
        " Use the agent tool for self-contained multi-step tasks that would otherwise fill this conversation with " +
        "intermediate results. The sub-agent cannot see this conversation: write the complete task in prompt. " +
        "Only its final reply comes back to you. Available sub-agents: " +
        (ctx.agents ?? []).map((def) => `${def.name} (${def.description})`).join("; ") + ".",
    },
  ],
  hooks: {
    // §7.3 规则 4：子智能体失败时工具结果为错误，details 照样保留。
    async tool_result(event) {
      if (event.toolName !== AGENT_TOOL_NAME) return undefined;
      const details = event.details as Partial<SubagentRunDetails> | undefined;
      return details?.kind === SUBAGENT_RUN_DETAILS_KIND && details.outcome === "failed" ? { isError: true } : undefined;
    },
  },
};
