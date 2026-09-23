// IMT 壁线形变手柄工具（SDD 04 D-12）——CS3D 自定义 BaseTool，替代旧手写 overlay 交互。
// 领域特化交互（高斯形变手柄）CS3D 无现成工具，按纲领「扩展框架而非平行实现」落在框架内。
// 数据归属仍是 Detection（D-14）：提交走 /task/measure 同步重算，不走 /annotations；
// 形变几何函数与旧实现同源（viewer/wallGeom），保证 IMT_mean 口径 ≤1e-6 mm 回归。
import { getRenderingEngine, utilities as csCoreUtils, type Types as CoreTypes } from "@cornerstonejs/core";
import { BaseTool, Enums as ToolEnums, type Types as ToolTypes } from "@cornerstonejs/tools";

import { api, ApiError } from "../api/client";
import type { Primitive } from "../api/types";
import { getT } from "../i18n";
import { taskViewFor } from "../data/actions";
import { useSession } from "../store/session";
import { registerTaskTool } from "./csTools";
import { IDENTITY_PIXEL_MAP, type PixelMap } from "./pixelMap";
import { clonePrims, deform, sampleHandles } from "./wallGeom";

type Poly = Extract<Primitive, { kind: "polyline" }>;
type Pts = number[][];

const HANDLE_HIT_PX = 10; // 命中半径（canvas px，与旧实现一致）

interface DragState {
  role: string;
  hx: number; // 手柄锚点 x（图像 px，形变中心）
  y0img: number; // 按下时的图像 y（位移基准）
  base: Pts; // 拖动前壁线点集
  sigma: number;
  prePrims: Primitive[]; // 拖动前全部原语（回滚用）
}

// 壁线编辑串行守卫：晚到的测量响应不覆盖新编辑（与 bridge 的 editSeq 同范式，
// 但壁线不走 bridge——数据归属 Detection，无乐观草稿）。
let wallSeq = 0;

export class ImtWallHandleTool extends BaseTool {
  static toolName = "ImtWallHandleTool";

  private drag: DragState | null = null;

  private pixelMap(): PixelMap {
    return (this.configuration as { pixelMap?: PixelMap }).pixelMap ?? IDENTITY_PIXEL_MAP;
  }

  private targetObject() {
    const objectId = (this.configuration as { objectId?: string }).objectId;
    if (!objectId) return null;
    return Object.values(useSession.getState().objects).flat().find((object) => object.id === objectId) ?? null;
  }

  /** 当前可编辑壁线（注册表 overlays editable=true 的 polyline）。 */
  private editableWalls(): Poly[] {
    const s = useSession.getState();
    const tv = taskViewFor(s, this.targetObject());
    const editable = new Set((tv?.overlays ?? []).filter((o) => o.editable).map((o) => o.role));
    return s.primitives.filter((p): p is Poly => p.kind === "polyline" && editable.has(p.role));
  }

  /** 当前帧由查看器注入；工具不构造 URL。 */
  private imageId(): string | null {
    return (this.configuration as { imageId?: string }).imageId ?? null;
  }

  /** 世界坐标 → canvas px（经 viewport 投影）。 */
  private toCanvas(evt: ToolTypes.EventTypes.InteractionEventType, world: CoreTypes.Point3): [number, number] | null {
    const { renderingEngineId, viewportId } = evt.detail;
    const vp = getRenderingEngine(renderingEngineId)?.getViewport(viewportId);
    if (!vp) return null;
    return vp.worldToCanvas(world) as [number, number];
  }

  /**
   * 按下抓手柄。**必须是 `preMouseDownCallback`**：CS3D 的 mouseDown 分发器只调
   * `preMouseDownCallback` / `postMouseDownCallback`（见 eventDispatchers/mouseEventHandlers/
   * mouseDown.js），压根不认 `mouseDownCallback`——挂错名字则 drag 状态永不建立，
   * 后续 mouseDrag/mouseUp 全部早退，工具静默失效。返回 true 表示事件已消费。
   */
  preMouseDownCallback(evt: ToolTypes.EventTypes.InteractionEventType): boolean {
    const imageId = this.imageId();
    if (!imageId) return false;
    const walls = this.editableWalls();
    if (!walls.length) return false;
    const world = evt.detail.currentPoints.world;
    const hitCanvas = this.toCanvas(evt, world);
    if (!hitCanvas) return false;
    for (const poly of walls) {
      for (const i of sampleHandles(poly.points)) {
        const w = csCoreUtils.imageToWorldCoords(imageId, this.pixelMap().toFrame(poly.points[i][0], poly.points[i][1]) as CoreTypes.Point2) as CoreTypes.Point3;
        const c = this.toCanvas(evt, w);
        if (!c) continue;
        if (Math.hypot(hitCanvas[0] - c[0], hitCanvas[1] - c[1]) < HANDLE_HIT_PX) {
          const [, y0img] = this.pixelMap().toObject(...csCoreUtils.worldToImageCoords(imageId, world) as CoreTypes.Point2);
          const xs = poly.points.map((q) => q[0]);
          const sigma = ((Math.max(...xs) - Math.min(...xs)) / sampleHandles(poly.points).length) * 0.7;
          this.drag = {
            role: poly.role,
            hx: poly.points[i][0],
            y0img,
            base: poly.points.map((q) => [...q]),
            sigma,
            prePrims: clonePrims(useSession.getState().primitives),
          };
          return true;
        }
      }
    }
    return false; // 未命中手柄：让位给分发器后续处理（不吞事件）
  }

  mouseDragCallback(evt: ToolTypes.EventTypes.InteractionEventType): void {
    const d = this.drag;
    const imageId = this.imageId();
    if (!d || !imageId) return;
    const [, iy] = this.pixelMap().toObject(...csCoreUtils.worldToImageCoords(imageId, evt.detail.currentPoints.world) as CoreTypes.Point2);
    const next = clonePrims(d.prePrims);
    for (const p of next) {
      if (p.kind === "polyline" && p.role === d.role) {
        p.points = deform(d.base, d.hx, iy - d.y0img, d.sigma);
      }
    }
    // 拖拽中间态直接入 store——overlay 的 primitives effect 实时重绘
    useSession.getState().setPrimitives(next);
  }

  async mouseUpCallback(): Promise<void> {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const st = useSession.getState();
    const obj = this.targetObject();
    const tv = taskViewFor(st, obj);
    const cal = obj?.calibration ?? null;
    const edited = clonePrims(st.primitives);
    if (!tv || !cal) {
      st.setPrimitives(d.prePrims);
      return;
    }
    const mySeq = ++wallSeq;
    const t = getT();
    try {
      const meas = await api.taskMeasure(tv.task, edited, cal);
      if (mySeq !== wallSeq) return; // 已被新编辑取代，丢弃过期响应
      const s = useSession.getState();
      s.setMetrics(meas.metrics);
      s.setSource("human"); // 编辑后来源翻人工
    } catch (e) {
      if (mySeq !== wallSeq) return; // 晚到的失败不覆盖后来者的成功
      // 服务端拒绝（校准缺失/解剖范围外 → 422）或网络失败 → 必须回滚到拖动前，
      // 否则画布新位置与面板旧值不一致（医学测量硬伤）。
      const s = useSession.getState();
      s.setPrimitives(d.prePrims);
      const isReject = e instanceof ApiError && e.status === 422;
      const why = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
      s.notify("crit", t(isReject ? "measure_rejected" : "measure_failed", { w: d.role, why }));
    }
  }
}

registerTaskTool("wall", ImtWallHandleTool, (group) => {
  group.setToolActive(ImtWallHandleTool.toolName, {
    bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }],
  });
});
