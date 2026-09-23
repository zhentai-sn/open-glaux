import { describe, expect, it } from "vitest";

import { bboxFromPoints, isRoiTooSmall, moveVertex } from "./wsiGeometry";

describe("WSI level-0 标注几何", () => {
  it("反向拖拽归一化为 bbox，并阻止过小 ROI", () => {
    const box = bboxFromPoints([100, 90], [20, 10]);
    expect(box).toEqual({ kind: "bbox", x0: 20, y0: 10, x1: 100, y1: 90 });
    expect(isRoiTooSmall(box)).toBe(false);
    expect(isRoiTooSmall(bboxFromPoints([0, 0], [23, 24]))).toBe(true);
  });

  it("移动 bbox 顶点时保持正宽高，移动 polygon 顶点时不改变其余点", () => {
    const box = bboxFromPoints([10, 20], [30, 40]);
    expect(moveVertex(box, 0, [50, 60])).toEqual({ kind: "bbox", x0: 30, y0: 40, x1: 50, y1: 60 });
    const poly = { kind: "polyline" as const, closed: true as const, points: [[1, 2], [3, 4], [5, 6]] };
    expect(moveVertex(poly, 1, [7, 8])).toEqual({ ...poly, points: [[1, 2], [7, 8], [5, 6]] });
  });
});
