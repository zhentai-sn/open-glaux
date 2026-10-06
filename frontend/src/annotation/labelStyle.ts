import type { Annotation } from "../api/types";

// 标注按标签着色（SDD 23 §5.1），CS3D 与 WSI 查看器共用。

export const SUGGESTION_COLOR = "rgb(255, 165, 0)";
export const UNLABELED_COLOR = "rgb(150, 150, 150)";

/** 目录标签取标签颜色；没有目录标签的建议保持橙色以便辨认；其余没有目录标签的标注为灰色。 */
export function annotationColor(a: Pick<Annotation, "status" | "label_color">): string {
  if (a.label_color) return a.label_color;
  return a.status === "suggested" ? SUGGESTION_COLOR : UNLABELED_COLOR;
}
