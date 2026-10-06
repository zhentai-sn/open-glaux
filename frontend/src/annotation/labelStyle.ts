import type { Annotation } from "../api/types";

// 标注按标签着色（SDD 23 §5.1），CS3D 与 WSI 查看器共用。

export const SUGGESTION_COLOR = "rgb(255, 165, 0)";
export const UNLABELED_COLOR = "rgb(150, 150, 150)";

/** 标注外接框 [x0, y0, x1, y1]（对象像素）；掩膜与点没有可用范围时为 null。 */
export function extentOf(p: Annotation["primitive"]): [number, number, number, number] | null {
  if (p.kind === "bbox") return [p.x0, p.y0, p.x1, p.y1];
  if (p.kind === "polyline" && p.points.length) {
    const xs = p.points.map((q) => q[0]);
    const ys = p.points.map((q) => q[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }
  return null;
}

/** 目录标签取标签颜色；没有目录标签的建议保持橙色以便辨认；其余没有目录标签的标注为灰色。 */
export function annotationColor(a: Pick<Annotation, "status" | "label_color">): string {
  if (a.label_color) return a.label_color;
  return a.status === "suggested" ? SUGGESTION_COLOR : UNLABELED_COLOR;
}
