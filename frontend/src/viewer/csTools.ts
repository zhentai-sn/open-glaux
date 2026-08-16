// Cornerstone3D tools 接线（SDD 04 §6.4 / T0 spike 结论）——
// raster_2d / volume_3d 两引擎共用的标注工具装配与激活映射：
// - 3.33.5 API 是 `ToolGroupManager.createToolGroup`（非 `ToolGroup.createToolGroup`），
//   id 重复返回 undefined，装配前先 destroy 旧组（StrictMode 双挂载/HMR 防护）；
// - 工具激活态的唯一真相源是 store.tool——activateTool 把统一 Tool 映射为 ToolGroup 状态；
// - 只借用 CS3D 的**交互**，不用其自带测量值（权威口径在 /task/measure，计划 §1.3-3）。
import {
  BrushTool,
  Enums as ToolEnums,
  PanTool,
  PlanarFreehandROITool,
  RectangleROITool,
  StackScrollTool,
  ToolGroupManager,
  WindowLevelTool,
  ZoomTool,
  addTool,
  init as toolsInit,
  type Types as ToolTypes,
} from "@cornerstonejs/tools";

import type { Tool, ToolOptions } from "../store/session";

let _ready: Promise<void> | null = null;

/** 一次性初始化（懒执行、幂等）：tools init + 注册全部工具类。 */
export function csToolsReady(): Promise<void> {
  if (!_ready) {
    _ready = (async () => {
      await toolsInit();
      addTool(RectangleROITool);
      addTool(PlanarFreehandROITool);
      addTool(BrushTool);
      addTool(PanTool);
      addTool(ZoomTool);
      addTool(StackScrollTool);
      addTool(WindowLevelTool);
    })();
  }
  return _ready;
}

const PRIMARY = { bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }] };

/** 新建 ToolGroup 并挂 viewport + 全部工具（id 冲突先拆旧组）。 */
export function createToolGroup(
  groupId: string,
  viewportId: string,
  renderingEngineId: string,
): ToolTypes.IToolGroup | null {
  try {
    ToolGroupManager.destroyToolGroup(groupId);
  } catch {
    /* 不存在则忽略 */
  }
  const tg = ToolGroupManager.createToolGroup(groupId);
  if (!tg) return null; // spike 注意项：id 重复 → undefined，防御返回
  tg.addViewport(viewportId, renderingEngineId);
  tg.addTool(RectangleROITool.toolName);
  tg.addTool(PlanarFreehandROITool.toolName);
  tg.addTool(BrushTool.toolName);
  tg.addTool(PanTool.toolName);
  tg.addTool(ZoomTool.toolName);
  tg.addTool(StackScrollTool.toolName);
  tg.addTool(WindowLevelTool.toolName);
  return tg;
}

/** 拆 ToolGroup（组件卸载时调用——StrictMode 双挂载防重复）。 */
export function destroyToolGroup(groupId: string): void {
  try {
    ToolGroupManager.destroyToolGroup(groupId);
  } catch {
    /* noop */
  }
}

/**
 * store.tool → ToolGroup 激活态映射（SDD 04 §7.1）。
 * `capabilities` 为注册表引擎能力位（wsi 无 brush 等）；越界工具回退 pan。
 */
export function activateTool(
  tg: ToolTypes.IToolGroup,
  tool: Tool,
  capabilities: readonly string[],
  options?: ToolOptions,
): void {
  for (const name of [
    RectangleROITool.toolName,
    PlanarFreehandROITool.toolName,
    BrushTool.toolName,
    PanTool.toolName,
    ZoomTool.toolName,
    WindowLevelTool.toolName,
  ]) {
    tg.setToolDisabled(name);
  }
  if (tool === "bbox" && capabilities.includes("bbox")) {
    tg.setToolActive(RectangleROITool.toolName, PRIMARY);
  } else if (tool === "polygon" && capabilities.includes("polygon")) {
    tg.setToolActive(PlanarFreehandROITool.toolName, PRIMARY);
  } else if (tool === "brush" && capabilities.includes("brush")) {
    if (options) {
      tg.setToolConfiguration(BrushTool.toolName, { radius: options.brush.radius });
    }
    tg.setToolActive(BrushTool.toolName, PRIMARY);
  } else {
    // cursor / reset / 能力位外的工具 → 平移（兜底，永不卡死交互）
    tg.setToolActive(PanTool.toolName, PRIMARY);
  }
}

export { BrushTool, PlanarFreehandROITool, RectangleROITool, StackScrollTool, ToolEnums, WindowLevelTool };
