// store.tool → CS3D ToolGroup 激活态映射的回归夹具（SDD 04 §7.1）。
// 锁住这次修复的核心不变量：**工具与模态解耦**。
// 曾经 polygon 在 carotid_imt 上被映射到 ImtWallHandleTool（只做壁线形变、不新建几何），
// 于是「多边形标注」在 IMT 上画不出任何东西；壁线又未检出时连形变都没有 → 完全静默。
// 现在 polygon 一律用逐点直线 SplineROI，壁线形变归独立的 wall 工具（能力位限定 IMT）。
import { describe, expect, it, vi } from "vitest";

import { activateTool, createToolGroup, csToolsReady, destroyToolGroup } from "./csTools";
import { ImtWallHandleTool } from "./imtWallTool";
import { PlanarFreehandROITool, RectangleROITool, SplineROITool, ToolGroupManager } from "@cornerstonejs/tools";
import type { Types as ToolTypes } from "@cornerstonejs/tools";

const ALL_CAPS = ["bbox", "polygon", "brush", "wall"];

/**
 * 绑定到指定 ToolGroup 的矩形工具实例。
 * `toolGroupId` 是 BaseTool 构造函数真实读取的字段，但 3.33.5 的 `PublicToolProps` d.ts
 * 没声明它（同 `textBoxVisibility` 那处缺口）——故断言一次。
 */
const rectIn = (groupId: string) =>
  new RectangleROITool({ toolGroupId: groupId } as unknown as ToolTypes.PublicToolProps, {});

/** 只记录调用的假 ToolGroup——activateTool 除这三个方法外不碰 tg。 */
function fakeToolGroup() {
  const active: Array<{ name: string; primary: boolean }> = [];
  const passive: string[] = [];
  const disabled: string[] = [];
  const tg = {
    setToolActive: (name: string, cfg?: { bindings?: Array<{ mouseButton: number }> }) =>
      active.push({ name, primary: cfg?.bindings?.[0]?.mouseButton === 1 }),
    setToolPassive: (name: string) => passive.push(name),
    setToolDisabled: (name: string) => disabled.push(name),
  } as unknown as ToolTypes.IToolGroup;
  /** 绑到鼠标左键的工具（滚轮缩放常驻，不算在内）。 */
  const primaryTool = () => active.find((a) => a.primary)?.name ?? null;
  return { tg, active, passive, disabled, primaryTool };
}

describe("activateTool：工具 → CS3D 工具映射", () => {
  it("polygon 激活自由多边形，绝不激活壁线手柄", () => {
    const f = fakeToolGroup();
    activateTool(f.tg, "polygon", ALL_CAPS);
    expect(f.primaryTool()).toBe(SplineROITool.toolName);
    expect(f.active.map((a) => a.name)).not.toContain(ImtWallHandleTool.toolName);
  });

  it("wall 激活壁线手柄", () => {
    const f = fakeToolGroup();
    activateTool(f.tg, "wall", ALL_CAPS);
    expect(f.primaryTool()).toBe(ImtWallHandleTool.toolName);
  });

  it("bbox 激活矩形 ROI", () => {
    const f = fakeToolGroup();
    activateTool(f.tg, "bbox", ALL_CAPS);
    expect(f.primaryTool()).toBe(RectangleROITool.toolName);
  });

  it("能力位缺失的工具回退平移，不留下哑掉的绘制态", () => {
    const f = fakeToolGroup();
    activateTool(f.tg, "wall", ["bbox", "polygon"]); // 非 IMT：无 wall 能力位
    expect(f.primaryTool()).toBe("Pan");
    expect(f.active.map((a) => a.name)).not.toContain(ImtWallHandleTool.toolName);
  });

  // 画布上不挂 CS3D 的数值标签（Area/Mean/Max/Std Dev/Perimeter）：
  // 权威口径在 /task/measure，非权威数字不上图；且每标注一块多行文本会糊满画布。
  // 断言走渲染器实际读的那条路——RectangleROITool.renderAnnotation 里
  // `const options = this.getLinkedTextBoxStyle(...); if (!options.visibility) continue;`
  it("ToolGroup 样式让标注文本框不可见（渲染器据此跳过整块标签与引线）", () => {
    const gid = "test-tg-textbox";
    try {
      try {
        createToolGroup(gid, "vp", "re");
      } catch {
        // jsdom 里没有真实 RenderingEngine，addViewport 会抛；样式在它之前已写入，断言照旧成立
      }
      const spec = (g: string) => ({ toolGroupId: g, toolName: RectangleROITool.toolName, viewportId: "vp" });
      expect(rectIn(gid).getLinkedTextBoxStyle(spec(gid), undefined).visibility).toBe(false);
      // 对照：未经 createToolGroup 设样式的组仍是 CS3D 默认的「显示」，证明上面的 false 确实来自本次设置
      const other = "test-tg-untouched";
      expect(rectIn(other).getLinkedTextBoxStyle(spec(other), undefined).visibility).toBe(true);
    } finally {
      destroyToolGroup(gid);
    }
  });

  it("polygon 工具实例配置为直线顶点，不使用默认平滑曲线", async () => {
    await csToolsReady();
    const gid = "test-tg-linear-polygon";
    const probe = ToolGroupManager.createToolGroup(`${gid}-probe`)!;
    const addViewport = vi.spyOn(Object.getPrototypeOf(probe) as ToolTypes.IToolGroup, "addViewport").mockImplementation(() => undefined);
    ToolGroupManager.destroyToolGroup(`${gid}-probe`);
    try {
      createToolGroup(gid, "vp", "re");
      const config = ToolGroupManager.getToolGroup(gid)?.getToolConfiguration(SplineROITool.toolName) as
        | { spline?: { type?: string } }
        | undefined;
      expect(config?.spline?.type).toBe(SplineROITool.SplineTypes.Linear);
    } finally {
      addViewport.mockRestore();
      destroyToolGroup(gid);
    }
  });

  it("任何工具态下绘制类工具都退 passive（disabled 会让已落库标注整片消失）", () => {
    const f = fakeToolGroup();
    activateTool(f.tg, "cursor", ALL_CAPS);
    expect(f.passive).toContain(RectangleROITool.toolName);
    expect(f.passive).toContain(PlanarFreehandROITool.toolName);
    expect(f.passive).toContain(SplineROITool.toolName);
    expect(f.disabled).not.toContain(RectangleROITool.toolName);
    expect(f.disabled).not.toContain(PlanarFreehandROITool.toolName);
    expect(f.disabled).not.toContain(SplineROITool.toolName);
  });
});
