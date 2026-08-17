// IMT 壁线形变几何（SDD 04 D-12/D-14）——任务绑定几何的纯函数核心：
// 手柄采样 + 高斯形变 + 原语深拷贝。ImtWallHandleTool 与 overlay 渲染共用，
// 保证「交互换框架、口径不变」（/task/measure 输入几何与原实现逐点一致）。
import type { Primitive } from "../api/types";

type Pts = number[][];

/** 形变手柄数（沿壁线均匀采样）——与旧手写实现一致，口径回归基线。 */
export const NUM_HANDLES = 9;

/** 壁线点数多于手柄数时均匀采样索引；否则全点皆手柄。 */
export function sampleHandles(pts: Pts): number[] {
  if (pts.length <= NUM_HANDLES) return pts.map((_, i) => i);
  return Array.from({ length: NUM_HANDLES }, (_, k) => Math.round((k * (pts.length - 1)) / (NUM_HANDLES - 1)));
}

/** 以 handleX 为中心、sigma 为宽度的高斯纵向位移——与旧实现同式（口径回归基线）。 */
export function deform(base: Pts, handleX: number, dy: number, sigma: number): Pts {
  return base.map(([x, y]) => [x, y + dy * Math.exp(-((x - handleX) ** 2) / (2 * sigma * sigma))]);
}

/** 原语深拷贝（polyline 点集可安全原地改）。 */
export function clonePrims(ps: Primitive[]): Primitive[] {
  return ps.map((p) => (p.kind === "polyline" ? { ...p, points: p.points.map((q) => [...q]) } : { ...p }));
}
