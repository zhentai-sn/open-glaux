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
  annotation,
  init as toolsInit,
  type Types as ToolTypes,
} from "@cornerstonejs/tools";

import type { Tool, ToolOptions } from "../store/session";
import { ImtWallHandleTool } from "./imtWallTool";

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
      addTool(ImtWallHandleTool); // SDD 04 D-12：IMT 高斯形变手柄
    })();
  }
  return _ready;
}

const PRIMARY = { bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }] };
const WHEEL = { bindings: [{ mouseButton: ToolEnums.MouseBindings.Wheel }] };

// 3.33.5 的 AnnotationStyle d.ts 的 Properties 联合漏了 `textBoxVisibility`——但运行期
// 默认样式表与 AnnotationTool.getLinkedTextBoxStyle 都在读它，是 d.ts 的缺口而非无此开关。
// 故此处显式断言一次（集中在这个常量里，调用点保持干净）。
const HIDE_TEXT_BOX = {
  global: { textBoxVisibility: false },
} as unknown as ToolTypes.AnnotationStyle.ToolStyleConfig;

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
  // 关掉 CS3D 的标注数值标签（Area/Mean/Max/Std Dev/Perimeter + 那条虚线引线）。
  // 两个理由：①这些是 CS3D 自带的测量值，而本项目的权威口径在 /task/measure（见文件头），
  //   把非权威数字摆在图上会被误读成测量结果；②每个标注挂一块多行文本，几个标注就糊满画布。
  // 用框架自己的样式开关（textBoxVisibility），作用域限本 ToolGroup，不改全局默认样式。
  annotation.config.style.setToolGroupToolStyles(groupId, HIDE_TEXT_BOX);
  tg.addViewport(viewportId, renderingEngineId);
  tg.addTool(RectangleROITool.toolName);
  tg.addTool(PlanarFreehandROITool.toolName);
  tg.addTool(BrushTool.toolName);
  tg.addTool(PanTool.toolName);
  tg.addTool(ZoomTool.toolName);
  tg.addTool(StackScrollTool.toolName);
  tg.addTool(WindowLevelTool.toolName);
  tg.addTool(ImtWallHandleTool.toolName);
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
 * `capabilities` 为注册表引擎能力位（wsi 无 brush、仅 IMT 有 wall 等）；越界工具回退 pan。
 * 工具与模态**解耦**：polygon 一律是自由多边形，壁线形变走独立的 wall 工具（D-12/D-14：
 * 壁线数据归属仍是 Detection，提交走 /task/measure，不落 /annotations）。
 * `opts.wheelZoom=false`（volume_3d）：滚轮留给查看器切 z，不绑 ZoomTool。
 */
export function activateTool(
  tg: ToolTypes.IToolGroup,
  tool: Tool,
  capabilities: readonly string[],
  options?: ToolOptions,
  opts?: { wheelZoom?: boolean },
): void {
  // 复位：**标注类**工具退到 passive 而非 disabled——CS3D 只渲染 active/passive/enabled 的
  // 工具的标注，disabled 的一律不画。把绘制工具 disable 掉会让已落库/刚画完的 bbox/polygon
  // 在切回光标的瞬间整片消失（画布上看着像"没保存"，其实库里在）。passive 还保留选中与
  // 顶点编辑，正是光标态该有的行为。无标注的工具（相机/画笔/壁线手柄）仍走 disabled。
  for (const name of [RectangleROITool.toolName, PlanarFreehandROITool.toolName]) {
    tg.setToolPassive(name);
  }
  for (const name of [
    BrushTool.toolName,
    PanTool.toolName,
    ZoomTool.toolName,
    WindowLevelTool.toolName,
    ImtWallHandleTool.toolName,
  ]) {
    tg.setToolDisabled(name);
  }
  // 滚轮缩放常驻（cursor/绘制态都要能缩放查看）；volume_3d 滚轮留给切 z
  if (opts?.wheelZoom !== false) {
    tg.setToolActive(ZoomTool.toolName, WHEEL);
  }
  if (tool === "bbox" && capabilities.includes("bbox")) {
    tg.setToolActive(RectangleROITool.toolName, PRIMARY);
  } else if (tool === "polygon" && capabilities.includes("polygon")) {
    tg.setToolActive(PlanarFreehandROITool.toolName, PRIMARY);
  } else if (tool === "wall" && capabilities.includes("wall")) {
    tg.setToolActive(ImtWallHandleTool.toolName, PRIMARY);
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
