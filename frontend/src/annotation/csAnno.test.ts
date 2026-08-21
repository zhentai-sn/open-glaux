// CS3D 标注层 ↔ 契约映射测试（SDD 04 §6.1）——回归夹具锁住 CS3D 3.x 的数据形状：
// - RectangleROI 的 handles.points 是四角，对角为 [0]/[3]（取 [0]/[1] 会得到零高矩形 → 落库被拒、框消失）；
// - 轮廓点在 data.contour.polyline（非 contour.points）。
// 坐标换算依赖 imageId 的 imagePlaneModule 元数据，这里以 ×2 的假变换替身，只验形状与取点。
import { describe, expect, it, vi } from "vitest";

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

const { PlanarFreehandROITool, RectangleROITool } = await import("@cornerstonejs/tools");
const { csToPrimitive, primitiveToCs } = await import("./csAnno");
type CsAnn = Parameters<typeof csToPrimitive>[0];

const IMG = "web:/api/image/tech_401";

function srvAnn(primitive: Parameters<typeof primitiveToCs>[0]["primitive"]) {
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
});

describe("primitiveToCs", () => {
  it("bbox → 四角句柄，[0]/[3] 为对角", () => {
    const cs = primitiveToCs(srvAnn({ kind: "bbox", x0: 10, y0: 10, x1: 50, y1: 40 }), IMG, "FOR-1") as CsAnn;
    const pts = (cs.data.handles as { points: number[][] }).points;
    expect(pts).toHaveLength(4);
    expect(pts[0]).toEqual([20, 80, 0]); // bottomLeft
    expect(pts[3]).toEqual([100, 20, 0]); // topRight
    expect(cs.metadata.FrameOfReferenceUID).toBe("FOR-1"); // 分组键：写错名字则标注永不渲染
  });

  it("polyline → contour.polyline + closed", () => {
    const prim = {
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
    expect(contour.polyline).toEqual([
      [0, 0, 0],
      [20, 0, 0],
      [20, 20, 0],
    ]);
  });

  it("往返：bbox / polyline 经 CS3D 形状回到原契约", () => {
    const bbox = { kind: "bbox" as const, x0: 10, y0: 10, x1: 50, y1: 40 };
    expect(csToPrimitive(primitiveToCs(srvAnn(bbox), IMG, "F") as CsAnn, IMG)).toEqual(bbox);
    const poly = {
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
});
