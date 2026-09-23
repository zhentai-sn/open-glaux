import type { ObjectMeta } from "../api/types";

/** `/frame?size=` 的显示像素与服务端标注使用的对象像素之间的换算。 */
export interface PixelMap {
  toFrame(x: number, y: number): [number, number];
  toObject(x: number, y: number): [number, number];
  objectDims: { columns: number; rows: number };
}

export function pixelMapFor(object: ObjectMeta, frame: { columns: number; rows: number }): PixelMap {
  const columns = object.axes.find((axis) => axis.name === "x")?.size ?? frame.columns;
  const rows = object.axes.find((axis) => axis.name === "y")?.size ?? frame.rows;
  const sx = frame.columns / columns;
  const sy = frame.rows / rows;
  if (!(sx > 0 && sy > 0)) throw new Error(`对象 ${object.id} 的帧尺寸无效`);
  return {
    toFrame: (x, y) => [x * sx, y * sy],
    toObject: (x, y) => [x / sx, y / sy],
    objectDims: { columns, rows },
  };
}

export const IDENTITY_PIXEL_MAP: PixelMap = {
  toFrame: (x, y) => [x, y],
  toObject: (x, y) => [x, y],
  objectDims: { columns: 0, rows: 0 },
};
