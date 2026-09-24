// CS3D 标注层 ↔ 契约映射测试（SDD 04 §6.1）——回归夹具锁住 CS3D 3.x 的数据形状：
// - RectangleROI 的 handles.points 是四角，对角为 [0]/[3]（取 [0]/[1] 会得到零高矩形 → 落库被拒、框消失）；
// - 轮廓点在 data.contour.polyline（非 contour.points）。
// 坐标换算依赖 imageId 的 imagePlaneModule 元数据，这里以 ×2 的假变换替身，只验形状与取点。
import { describe, expect, it, vi } from "vitest";

import type { Annotation, AnnotationPrimitive } from "../api/types";

vi.mock("@cornerstonejs/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@cornerstonejs/core")>();
  return {
    ...actual,
    utilities: {
      ...actual.utilities,
      imageToWorldCoords: (_id: string, [x, y]: [number, number]) => [x * 2, y * 2, 0],
      worldToImageCoords: (_id: string, [wx, wy]: [number, number, number]) => [wx / 2, wy / 2],
    },
  };
});

const { PlanarFreehandROITool, RectangleROITool, SplineROITool } = await import("@cornerstonejs/tools");
const { csToPrimitive, primitiveToCs } = await import("./csAnno");
const { pixelMapFor } = await import("../viewer/pixelMap");
const { objectMeta } = await import("../test/fixtures");
type CsAnn = Parameters<typeof csToPrimitive>[0];

const IMG = "web:/api/image/tech_401";

function srvAnn(primitive: AnnotationPrimitive): Annotation {
  return {
    id: "a1",
    image_id: "tech_401",
    z: null,
    primitive,
    label: "",
    class_id: null,
    status: "draft" as const,
    source: "manual" as const,
    seq: 1,
  };
}

describe("csToPrimitive", () => {
  it("RectangleROI 四角（对角在 [0]/[3]）→ bbox 取 AABB", () => {
    const ann = {
      metadata: { toolName: RectangleROITool.toolName },
      data: {
        handles: {
          // bottomLeft / bottomRight / topLeft / topRight（世界系 = 图像 px ×2）
          points: [
            [20, 80, 0],
            [100, 80, 0],
            [20, 20, 0],
            [100, 20, 0],
          ],
        },
      },
    } as unknown as CsAnn;
    expect(csToPrimitive(ann, IMG)).toEqual({ kind: "bbox", x0: 10, y0: 10, x1: 50, y1: 40 });
  });

  it("PlanarFreehandROI 的轮廓读 contour.polyline", () => {
    const ann = {
      metadata: { toolName: PlanarFreehandROITool.toolName },
      data: {
        contour: {
          polyline: [
            [0, 0, 0],
            [20, 0, 0],
            [20, 20, 0],
          ],
          closed: true,
        },
      },
    } as unknown as CsAnn;
    expect(csToPrimitive(ann, IMG)).toEqual({
      kind: "polyline",
      closed: true,
      points: [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
    });
  });

  it("直线 SplineROI 保存用户点击的控制点，不保存渲染器生成的轮廓点", () => {
    const ann = {
      metadata: { toolName: SplineROITool.toolName },
      data: {
        handles: { points: [[0, 0, 0], [20, 0, 0], [20, 20, 0]] },
        contour: { polyline: [[0, 0, 0], [10, 0, 0], [20, 0, 0], [20, 20, 0]], closed: true },
      },
    } as unknown as CsAnn;
    expect(csToPrimitive(ann, IMG)).toEqual({ kind: "polyline", closed: true, points: [[0, 0], [10, 0], [10, 10]] });
  });
});

describe("primitiveToCs", () => {
  it("bbox → 四角句柄，[0]/[3] 为对角", () => {
    const cs = primitiveToCs(srvAnn({ kind: "bbox", x0: 10, y0: 10, x1: 50, y1: 40 }), IMG, "FOR-1") as CsAnn;
    const pts = (cs.data.handles as { points: number[][] }).points;
    expect(pts).toHaveLength(4);
    expect(pts[0]).toEqual([20, 80, 0]); // bottomLeft
    expect(pts[3]).toEqual([100, 20, 0]); // topRight
    expect(cs.metadata?.FrameOfReferenceUID).toBe("FOR-1"); // 分组键：写错名字则标注永不渲染
  });

  it("polyline → contour.polyline + closed", () => {
    const prim: AnnotationPrimitive = {
      kind: "polyline" as const,
      closed: true,
      points: [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
    };
    const cs = primitiveToCs(srvAnn(prim), IMG, "FOR-1") as CsAnn;
    const contour = (cs.data as { contour: { polyline: number[][]; closed: boolean } }).contour;
    expect(contour.closed).toBe(true);
    expect(cs.metadata?.toolName).toBe(SplineROITool.toolName);
    expect((cs.data.handles as { points: number[][] }).points).toEqual(contour.polyline);
    expect((cs.data as { spline: { type: string } }).spline.type).toBe(SplineROITool.SplineTypes.Linear);
    expect(contour.polyline).toEqual([
      [0, 0, 0],
      [20, 0, 0],
      [20, 20, 0],
    ]);
  });

  it("往返：bbox / polyline 经 CS3D 形状回到原契约", () => {
    const bbox = { kind: "bbox" as const, x0: 10, y0: 10, x1: 50, y1: 40 };
    expect(csToPrimitive(primitiveToCs(srvAnn(bbox), IMG, "F") as CsAnn, IMG)).toEqual(bbox);
    const poly: AnnotationPrimitive = {
      kind: "polyline" as const,
      closed: true,
      points: [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
    };
    expect(csToPrimitive(primitiveToCs(srvAnn(poly), IMG, "F") as CsAnn, IMG)).toEqual(poly);
  });

  it("缩小预览帧上的框与多边形往返保持对象坐标", () => {
    const object = objectMeta({ id: "large", modality: "natural_image" });
    object.axes = [{ name: "x", size: 8192 }, { name: "y", size: 6000 }];
    const map = pixelMapFor(object, { columns: 4096, rows: 3000 });
    const primitives: AnnotationPrimitive[] = [
      { kind: "bbox", x0: 1000, y0: 800, x1: 4000, y1: 3000 },
      { kind: "polyline", closed: true, points: [[1000, 800], [4000, 800], [4000, 3000]] },
    ];
    for (const primitive of primitives) {
      const cs = primitiveToCs(srvAnn(primitive), IMG, "F", map) as CsAnn;
      expect(csToPrimitive(cs, IMG, map)).toEqual(primitive);
    }
  });
});

// --- 建议态渲染（SDD 02）：状态驱动样式与可见性 ------------------------------

const { annotation: csAnnState } = await import("@cornerstonejs/tools");
const { syncCsAnnotations, resetCsAnnoBridge } = await import("./csAnno");

function suggestion(over: Partial<ReturnType<typeof srvAnn>> = {}) {
  return { ...srvAnn({ kind: "bbox", x0: 1, y0: 1, x1: 9, y1: 9 }), ...over };
}

describe("syncCsAnnotations · 建议态", () => {
  it("suggested 落成橙色虚线，与人工标注一眼可辨", () => {
    resetCsAnnoBridge();
    const styles: Record<string, unknown> = {};
    const spy = vi
      .spyOn(csAnnState.config.style, "setAnnotationStyles")
      .mockImplementation((uid, s) => {
        styles[uid] = s;
      });
    vi.spyOn(csAnnState.state, "addAnnotation").mockReturnValue("cs-1");

    syncCsAnnotations([suggestion({ id: "s1", status: "suggested", source: "agent" })], IMG, "FOR", "FOR");
    expect(spy).toHaveBeenCalled();
    expect(styles["cs-1"]).toMatchObject({ lineDash: "6,4" });
    expect(String((styles["cs-1"] as Record<string, string>).color)).toMatch(/255, 165, 0/u);
    vi.restoreAllMocks();
  });

  it("rejected 不进画布——驳回的建议留库可审计但不占视野", () => {
    resetCsAnnoBridge();
    const add = vi.spyOn(csAnnState.state, "addAnnotation").mockReturnValue("cs-2");
    vi.spyOn(csAnnState.config.style, "setAnnotationStyles").mockImplementation(() => {});

    syncCsAnnotations([suggestion({ id: "s2", status: "rejected", source: "agent" })], IMG, "FOR", "FOR");
    expect(add).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("确认后清空建议样式——几何没变，只有状态跃迁也要重刷", () => {
    resetCsAnnoBridge();
    const styles: Record<string, unknown> = {};
    vi.spyOn(csAnnState.config.style, "setAnnotationStyles").mockImplementation((uid, s) => {
      styles[uid] = s;
    });
    vi.spyOn(csAnnState.state, "addAnnotation").mockReturnValue("cs-3");

    const pending = suggestion({ id: "s3", status: "suggested", source: "agent" });
    syncCsAnnotations([pending], IMG, "FOR", "FOR");
    expect(styles["cs-3"]).toMatchObject({ lineDash: "6,4" });

    const changed = syncCsAnnotations([{ ...pending, status: "confirmed" as const }], IMG, "FOR", "FOR");
    expect(styles["cs-3"]).toEqual({}); // 回到与人工标注同一外观
    expect(changed).toBe(true); // 需触发重绘
    vi.restoreAllMocks();
  });
});
