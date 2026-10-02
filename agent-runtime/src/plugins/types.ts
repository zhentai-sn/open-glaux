/** SDD 15 §9.1：插件契约。工具、钩子、提示词片段以插件为单位登记。 */
import type {
  AgentMessage,
  ToolCallEvent,
  ToolCallResult,
  ToolResultEvent,
  ToolResultPatch,
} from "@earendil-works/pi-agent-core";

import type { ToolProvider, ViewerContext } from "../contracts.js";
import type { HarnessToolContext } from "../pi/harness-registry.js";

/** SDD 15 §7.3：工具副作用等级，权限模式按它决定放行、审批或不挂载。 */
export const TOOL_EFFECTS = ["read", "annotate", "compute", "egress", "write", "exec", "delegate"] as const;
export type ToolEffect = (typeof TOOL_EFFECTS)[number];

export interface PluginTool extends ToolProvider {
  effect: ToolEffect;
  /** 规则 pattern 的匹配对象；缺省则带 pattern 的规则不命中（SDD 15 §7.5）。 */
  permissionSubject?(args: Record<string, unknown>): string | undefined;
}

/** 一次命令内钩子可见的运行上下文；后续波次在此增加权限、交互、预算。 */
export interface RunContext {
  sessionId: string;
  commandId: string;
  projectId?: string;
  viewer?: ViewerContext;
}

export interface PluginHooks {
  tool_call?(event: ToolCallEvent, ctx: RunContext): Promise<ToolCallResult | undefined>;
  tool_result?(event: ToolResultEvent, ctx: RunContext): Promise<ToolResultPatch | undefined>;
  context?(messages: AgentMessage[], ctx: RunContext): Promise<AgentMessage[]>;
}

export interface GlauxPlugin {
  name: string;
  /** 插件整体是否参与本次命令；工具级条件仍由各工具的 `requires` / `supports` 判定。 */
  applies(ctx: HarnessToolContext): boolean;
  tools?: PluginTool[];
  hooks?: PluginHooks;
  promptFragment?(ctx: HarnessToolContext): string;
}
