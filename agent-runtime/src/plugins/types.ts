/** SDD 15 §9.1：插件契约。工具、钩子、提示词片段以插件为单位登记。 */
import type {
  AgentMessage,
  ToolCallEvent,
  ToolCallResult,
  ToolResultEvent,
  ToolResultPatch,
} from "@earendil-works/pi-agent-core";

import type { ToolProvider, ViewerContext } from "../contracts.js";
import type { RunBudget } from "../budget/run-budget.js";
import type { PermissionRunState } from "../permission/plugin.js";
import type { HarnessToolContext } from "../pi/harness-registry.js";

/** SDD 15 §7.3：工具副作用等级，权限模式按它决定放行、审批或不挂载。 */
export const TOOL_EFFECTS = ["read", "annotate", "compute", "egress", "write", "exec", "delegate"] as const;
export type ToolEffect = (typeof TOOL_EFFECTS)[number];

export interface PluginTool extends ToolProvider {
  effect: ToolEffect;
  /** 作用于「当前对象」，执行前做项目越界判定（SDD 13 §7.8 规则 4、SDD 15 §7.5 第 1 步）。 */
  projectScoped?: boolean;
  /** 规则 pattern 的匹配对象；缺省则带 pattern 的规则不命中（SDD 15 §7.5）。 */
  permissionSubject?(args: Record<string, unknown>): string | undefined;
  /** 带路径参数的工具：解析路径范围，取代 `permissionSubject`（SDD 16 §9.1）。 */
  pathScope?(args: Record<string, unknown>, cwd: string, readableRoots?: readonly string[]): Promise<PathScope | undefined>;
  /** 规则 pattern 的匹配方式；缺省为 glob（SDD 16 §7.5 规则 5）。 */
  patternMatch?(pattern: string, subject: string): boolean;
}

/** SDD 16 §9.1：规则匹配用的 subject 与是否敏感。 */
export interface PathScope {
  subject: string;
  sensitive: boolean;
}

/** 一次命令内钩子可见的运行上下文；后续波次在此增加权限、交互、预算。 */
export interface RunContext {
  sessionId: string;
  commandId: string;
  projectId?: string;
  viewer?: ViewerContext;
  /** 权限判定所需的状态；缺省时权限插件不判定（chat 发行版、单元测试）。 */
  permission?: PermissionRunState;
  /** 本命令的运行预算（SDD 15 §7.8）；缺省时预算插件不拦截。 */
  budget?: RunBudget;
  /** 子智能体内的运行：交互请求带上来源（SDD 18 §7.4）。 */
  origin?: { subagent: string };
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
