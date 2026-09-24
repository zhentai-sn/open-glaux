import type { AnnotationPrimitive } from "../api/types";

export const MIN_ROI = 24;

/** 绘制命中半径使用 SVG/视口的 CSS 像素，不随 WSI 缩放改变。 */
export function withinScreenRadius(a: [number, number], b: [number, number], radius: number): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) <= radius;
}

export function bboxFromPoints(a: [number, number], b: [number, number]): Extract<AnnotationPrimitive, { kind: "bbox" }> {
  return {
    kind: "bbox",
    x0: Math.min(a[0], b[0]),
    y0: Math.min(a[1], b[1]),
    x1: Math.max(a[0], b[0]),
    y1: Math.max(a[1], b[1]),
  };
}

export function isRoiTooSmall(primitive: AnnotationPrimitive, min = MIN_ROI): boolean {
  return primitive.kind === "bbox" &&
    (primitive.x1 - primitive.x0 < min || primitive.y1 - primitive.y0 < min);
}

export function moveVertex(
  primitive: Exclude<AnnotationPrimitive, { kind: "mask" }>,
  vertex: number,
  point: [number, number],
): Exclude<AnnotationPrimitive, { kind: "mask" }> {
  if (primitive.kind === "polyline") {
    return {
      ...primitive,
      points: primitive.points.map((p, i) => i === vertex ? point : p),
    };
  }
  const corners: [number, number][] = [
    [primitive.x0, primitive.y0],
    [primitive.x1, primitive.y0],
    [primitive.x1, primitive.y1],
    [primitive.x0, primitive.y1],
  ];
  return bboxFromPoints(corners[(vertex + 2) % 4], point);
}
