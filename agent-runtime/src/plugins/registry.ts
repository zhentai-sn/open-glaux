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
import { TOOL_EFFECTS, type GlauxPlugin, type PluginTool } from "./types.js";
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

function toolAvailable(tool: PluginTool, ctx: HarnessToolContext): boolean {
  if (tool.requires.project && !ctx.projectId) return false;
  if (tool.requires.vision && !ctx.connection?.vision) return false;
  if (tool.requires.runtime && !ctx.runtime) return false;
  // 挂一个必然失败的工具只会让模型反复重试并把失败当成"图里没有该结构"（SDD 02 §7.4）。
  if (tool.requires.egress && (!segmentationEgressAllowed() || !process.env.GLAUX_SEG_API_TOKEN?.trim())) return false;
  return tool.supports(ctx.viewer?.focus);
}

/** 本次命令可挂载的工具：插件参与且工具自身条件满足。 */
export function availableTools(ctx: HarnessToolContext, plugins: readonly GlauxPlugin[] = PLUGINS): PluginTool[] {
  return activePlugins(ctx, plugins).flatMap((plugin) => (plugin.tools ?? []).filter((tool) => toolAvailable(tool, ctx)));
}

/** 按登记顺序拼接参与插件的整体片段与已挂工具的片段。 */
export function promptFragments(
  ctx: HarnessToolContext, mounted: ReadonlySet<string>, plugins: readonly GlauxPlugin[] = PLUGINS,
): string {
  return activePlugins(ctx, plugins).map((plugin) =>
    (plugin.promptFragment?.(ctx) ?? "") +
    (plugin.tools ?? []).filter((tool) => mounted.has(tool.name)).map((tool) => tool.promptFragment(ctx)).join(""),
  ).join("");
}
