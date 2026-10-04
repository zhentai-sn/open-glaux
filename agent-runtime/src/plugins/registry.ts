/**
 * SDD 15 §7.1：插件登记表。数组顺序即提示词片段的拼接顺序与钩子的执行顺序。
 * `budget`、`permission` 插件恒排在最前（§7.1 规则 4）。
 */
import type { HarnessToolContext } from "../pi/harness-registry.js";
import { segmentationEgressAllowed } from "../pi/tools/segment-region.js";
import { annotationPlugin } from "./annotation.js";
import { atlasPlugin } from "./atlas.js";
import { imagingPlugin } from "./imaging.js";
import { interactionPlugin } from "./interaction.js";
import { permissionPlugin } from "../permission/plugin.js";
import { budgetPlugin } from "../budget/plugin.js";
import { contextPruningPlugin } from "./context-pruning.js";
import { filesPlugin } from "./files.js";
import { projectPlugin } from "./project.js";
import { subagentsPlugin } from "./subagents.js";
import { TOOL_EFFECTS, type GlauxPlugin, type PluginTool, type ToolEffect } from "./types.js";
import { videoPlugin } from "./video.js";

export const PLUGINS: readonly GlauxPlugin[] = [
  budgetPlugin,
  permissionPlugin,
  interactionPlugin,
  videoPlugin,
  imagingPlugin,
  atlasPlugin,
  annotationPlugin,
  projectPlugin,
  filesPlugin,
  subagentsPlugin,
  contextPruningPlugin,
];

/** 启动期校验：插件名与工具名不重复，每个工具声明合法的 effect。 */
export function validatePlugins(plugins: readonly GlauxPlugin[]): void {
  const pluginNames = new Set<string>();
  const toolNames = new Set<string>();
  for (const plugin of plugins) {
    if (pluginNames.has(plugin.name)) throw new Error(`Duplicate plugin name: ${plugin.name}`);
    pluginNames.add(plugin.name);
    for (const tool of plugin.tools ?? []) {
      if (toolNames.has(tool.name)) throw new Error(`Duplicate tool name: ${tool.name}`);
      toolNames.add(tool.name);
      if (!(TOOL_EFFECTS as readonly string[]).includes(tool.effect)) {
        throw new Error(`Tool ${tool.name} in plugin ${plugin.name} must declare a valid effect.`);
      }
    }
  }
}

validatePlugins(PLUGINS);

/** 全部插件工具，按登记顺序。 */
export function pluginTools(plugins: readonly GlauxPlugin[] = PLUGINS): PluginTool[] {
  return plugins.flatMap((plugin) => plugin.tools ?? []);
}

/** 本次命令参与的插件。 */
export function activePlugins(ctx: HarnessToolContext, plugins: readonly GlauxPlugin[] = PLUGINS): GlauxPlugin[] {
  return plugins.filter((plugin) => plugin.applies(ctx));
}

/** 未挂载原因（SDD 19 §7.5 规则 4）；`mode` 由调用方按权限模式判定。 */
export type UnmountedReason =
  | "needs_project" | "needs_vision" | "needs_runtime" | "needs_egress"
  | "plugin_inactive" | "unsupported_focus" | "mode";

/** 工具自身的声明式条件，先于插件条件判定，能给出具体原因。 */
function requirementGap(tool: PluginTool, ctx: HarnessToolContext): UnmountedReason | undefined {
  if (tool.requires.project && !ctx.projectId) return "needs_project";
  if (tool.requires.vision && !ctx.connection?.vision) return "needs_vision";
  if (tool.requires.runtime && !ctx.runtime) return "needs_runtime";
  // 挂一个必然失败的工具只会让模型反复重试并把失败当成"图里没有该结构"（SDD 02 §7.4）。
  if (tool.requires.egress && (!segmentationEgressAllowed() || !process.env.GLAUX_SEG_API_TOKEN?.trim())) return "needs_egress";
  return undefined;
}

/** 工具在本次命令不可挂载的原因（不计权限模式）；可挂载时为 `undefined`。 */
export function unavailableReason(
  plugin: GlauxPlugin, tool: PluginTool, ctx: HarnessToolContext,
): UnmountedReason | undefined {
  const gap = requirementGap(tool, ctx);
  if (gap) return gap;
  if (!plugin.applies(ctx)) return "plugin_inactive";
  if (!tool.supports(ctx.viewer?.focus)) return "unsupported_focus";
  return undefined;
}

/** 本次命令可挂载的工具：插件参与且工具自身条件满足。 */
export function availableTools(ctx: HarnessToolContext, plugins: readonly GlauxPlugin[] = PLUGINS): PluginTool[] {
  return activePlugins(ctx, plugins).flatMap((plugin) =>
    (plugin.tools ?? []).filter((tool) => !requirementGap(tool, ctx) && tool.supports(ctx.viewer?.focus)));
}

/** 按登记顺序，每个参与插件的整体片段加已挂工具的片段；空片段不出现（SDD 19 §9.2）。 */
export function promptFragmentParts(
  ctx: HarnessToolContext, mounted: ReadonlySet<string>, plugins: readonly GlauxPlugin[] = PLUGINS,
): { plugin: string; text: string }[] {
  return activePlugins(ctx, plugins)
    .map((plugin) => ({
      plugin: plugin.name,
      text: (plugin.promptFragment?.(ctx) ?? "") +
        (plugin.tools ?? []).filter((tool) => mounted.has(tool.name)).map((tool) => tool.promptFragment(ctx)).join(""),
    }))
    .filter((part) => part.text);
}

/** 按登记顺序拼接参与插件的整体片段与已挂工具的片段。 */
export function promptFragments(
  ctx: HarnessToolContext, mounted: ReadonlySet<string>, plugins: readonly GlauxPlugin[] = PLUGINS,
): string {
  return promptFragmentParts(ctx, mounted, plugins).map((part) => part.text).join("");
}

export type ToolRequirement = "project" | "vision" | "runtime" | "egress";
const REQUIREMENTS: readonly ToolRequirement[] = ["project", "vision", "runtime", "egress"];

/** SDD 19 §9.1：资源清单中的工具目录条目。 */
export interface ToolItem {
  name: string;
  plugin: string;
  effect: ToolEffect;
  requires: ToolRequirement[];
}

/** 全部插件工具的静态目录，按登记顺序；不依赖会话（SDD 19 §7.5 规则 1、2）。 */
export function toolCatalog(plugins: readonly GlauxPlugin[] = PLUGINS): ToolItem[] {
  return plugins.flatMap((plugin) => (plugin.tools ?? []).map((tool) => ({
    name: tool.name,
    plugin: plugin.name,
    effect: tool.effect,
    requires: REQUIREMENTS.filter((key) => tool.requires[key]),
  })));
}
