/**
 * SDD 19 §9.2、§9.3：系统提示词预览——分段、已挂载工具的模型可见定义、未挂载原因与 token 估算。
 */
import type { PermissionMode } from "../contracts.js";
import { mountable } from "../permission/decide.js";
import { PLUGINS, unavailableReason, type UnmountedReason } from "../plugins/registry.js";
import type { ToolEffect } from "../plugins/types.js";
import type { HarnessTool, HarnessToolContext, PromptSegmentDraft } from "./harness-registry.js";

export interface PromptSegment extends PromptSegmentDraft {
  est_tokens: number;
}

export interface MountedTool {
  name: string;
  plugin: string;
  effect: ToolEffect | "";
  description: string;
  parameters: unknown;
  est_tokens: number;
}

export interface UnmountedTool {
  name: string;
  plugin: string;
  reason: UnmountedReason;
}

export interface SystemPromptPreview {
  prompt: string;
  segments: PromptSegment[];
  tools: MountedTool[];
  unmounted: UnmountedTool[];
  est_tokens: { prompt: number; tools: number };
}

/**
 * 与 pi 上下文压缩判定同一换算：字符数 ÷ 4 向上取整
 * （`@earendil-works/pi-agent-core` 的 `estimateTokens`，该函数只接受消息）。
 */
export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function buildPreview(input: {
  prompt: string;
  segments: readonly PromptSegmentDraft[];
  tools: readonly HarnessTool[];
  /** chat 发行版缺省：没有工具，也不列未挂载原因。 */
  context: HarnessToolContext | undefined;
  mode: PermissionMode;
}): SystemPromptPreview {
  const owner = new Map(PLUGINS.flatMap((plugin) => (plugin.tools ?? []).map((tool) => [tool.name, { plugin: plugin.name, effect: tool.effect }] as const)));
  const tools = input.tools.map((tool): MountedTool => {
    const parameters = tool.parameters as unknown;
    return {
      name: tool.name,
      plugin: owner.get(tool.name)?.plugin ?? "",
      effect: owner.get(tool.name)?.effect ?? "",
      description: tool.description,
      parameters,
      est_tokens: estimateTextTokens(tool.name + tool.description + JSON.stringify(parameters ?? {})),
    };
  });
  const mounted = new Set(tools.map((tool) => tool.name));
  const unmounted: UnmountedTool[] = [];
  if (input.context) {
    for (const plugin of PLUGINS) {
      for (const tool of plugin.tools ?? []) {
        if (mounted.has(tool.name)) continue;
        const reason = unavailableReason(plugin, tool, input.context) ?? (mountable(tool.effect, input.mode) ? undefined : "mode");
        if (reason) unmounted.push({ name: tool.name, plugin: plugin.name, reason });
      }
    }
  }
  return {
    prompt: input.prompt,
    segments: input.segments.map((segment) => ({ ...segment, est_tokens: estimateTextTokens(segment.text) })),
    tools,
    unmounted,
    est_tokens: {
      prompt: estimateTextTokens(input.prompt),
      tools: tools.reduce((sum, tool) => sum + tool.est_tokens, 0),
    },
  };
}
