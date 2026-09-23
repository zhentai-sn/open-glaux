import type { Index, Primitive, TaskOverlaySpec } from "../../api/types";
import { sampleHandles } from "../wallGeom";
import type { Painter } from "../contract";

type Project = (x: number, y: number) => [number, number];

function strokePath(context: CanvasRenderingContext2D, points: number[][], project: Project, color: string, close = false) {
  if (points.length < 2) return;
  context.beginPath();
  points.forEach(([x, y], index) => {
    const [cx, cy] = project(x, y);
    if (index === 0) context.moveTo(cx, cy);
    else context.lineTo(cx, cy);
  });
  if (close) context.closePath();
  context.lineWidth = 1.8;
  context.strokeStyle = color;
  context.lineJoin = "round";
  context.shadowColor = color;
  context.shadowBlur = 5;
  context.stroke();
  context.shadowBlur = 0;
}

const polyline: Painter = (context, primitive, project, options) => {
  if (primitive.kind !== "polyline") return;
  strokePath(context, primitive.points, project, options.color, primitive.closed);
};

const ellipse: Painter = (context, primitive, project, options) => {
  if (primitive.kind !== "ellipse") return;
  const points = Array.from({ length: 97 }, (_, k) => {
    const angle = (k / 96) * Math.PI * 2;
    return [
      primitive.cx + primitive.a * Math.cos(angle) * Math.cos(primitive.theta) - primitive.b * Math.sin(angle) * Math.sin(primitive.theta),
      primitive.cy + primitive.a * Math.cos(angle) * Math.sin(primitive.theta) + primitive.b * Math.sin(angle) * Math.cos(primitive.theta),
    ];
  });
  strokePath(context, points, project, options.color);
  const drawAxis = (dx: number, dy: number, length: number, color: string) => {
    const [x0, y0] = project(primitive.cx - length * dx, primitive.cy - length * dy);
    const [x1, y1] = project(primitive.cx + length * dx, primitive.cy + length * dy);
    context.beginPath();
    context.moveTo(x0, y0);
    context.lineTo(x1, y1);
    context.lineWidth = 1.1;
    context.strokeStyle = color;
    context.stroke();
  };
  drawAxis(Math.cos(primitive.theta), Math.sin(primitive.theta), primitive.a, "rgba(255,138,91,.85)");
  drawAxis(-Math.sin(primitive.theta), Math.cos(primitive.theta), primitive.b, "rgba(79,176,255,.85)");
};

const bbox: Painter = (context, primitive, project, options) => {
  if (primitive.kind !== "bbox") return;
  const [x0, y0] = project(primitive.x0, primitive.y0);
  const [x1, y1] = project(primitive.x1, primitive.y1);
  context.strokeStyle = options.color;
  context.lineWidth = 1.8;
  context.strokeRect(x0, y0, x1 - x0, y1 - y0);
};

const pointSet: Painter = (context, primitive, project, options) => {
  if (primitive.kind !== "point_set") return;
  const colorByClass = new Map(options.classes?.map((item) => [item.class_id, item.color]));
  primitive.points.forEach(([x, y], index) => {
    const [cx, cy] = project(x, y);
    context.beginPath();
    context.arc(cx, cy, 2.5, 0, Math.PI * 2);
    context.fillStyle = colorByClass.get(primitive.point_class_ids[index]) ?? options.color;
    context.fill();
  });
};

// mask PNG 的像素由宿主异步加载；volume_mask 由逐层 labelmap painter 绘制。
export const PAINTERS: Record<string, Painter> = { polyline, ellipse, bbox, point_set: pointSet };

function inIndex(primitive: Primitive, index: Index): boolean {
  const own = (primitive as Primitive & { index?: Index }).index;
  return !own || Object.entries(own).every(([axis, value]) => index[axis as keyof Index] === value);
}

export function drawPrimitives(
  context: CanvasRenderingContext2D,
  primitives: Primitive[],
  project: Project,
  options: { overlays: TaskOverlaySpec[]; index: Index; wallEditing: boolean },
) {
  const byRole = new Map(options.overlays.map((overlay) => [overlay.role, overlay]));
  const walls = primitives.filter((primitive): primitive is Extract<Primitive, { kind: "polyline" }> =>
    primitive.kind === "polyline" && !!byRole.get(primitive.role)?.editable && inIndex(primitive, options.index),
  );
  if (walls.length >= 2 && walls[0].points.length > 1 && walls[1].points.length > 1) {
    context.beginPath();
    walls[0].points.forEach(([x, y], index) => {
      const [cx, cy] = project(x, y);
      if (index === 0) context.moveTo(cx, cy);
      else context.lineTo(cx, cy);
    });
    for (let i = walls[1].points.length - 1; i >= 0; i--) {
      const [cx, cy] = project(walls[1].points[i][0], walls[1].points[i][1]);
      context.lineTo(cx, cy);
    }
    context.closePath();
    context.fillStyle = "rgba(79,176,255,.09)";
    context.fill();
  }

  for (const primitive of primitives) {
    if (!inIndex(primitive, options.index)) continue;
    const painter = PAINTERS[primitive.kind];
    if (!painter) continue;
    const role = "role" in primitive ? primitive.role : "";
    const overlay = byRole.get(role);
    const color = overlay?.color ?? "#4FB0FF";
    painter(context, primitive, project, { color, index: options.index, classes: "classes" in primitive ? primitive.classes : undefined });
    if (options.wallEditing && overlay?.editable && primitive.kind === "polyline") {
      context.fillStyle = color;
      context.strokeStyle = "#111";
      context.lineWidth = 1.5;
      for (const i of sampleHandles(primitive.points)) {
        const [cx, cy] = project(primitive.points[i][0], primitive.points[i][1]);
        context.beginPath();
        context.arc(cx, cy, 5, 0, 7);
        context.fill();
        context.stroke();
      }
    }
  }
}
