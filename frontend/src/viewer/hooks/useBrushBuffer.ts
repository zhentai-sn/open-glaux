import { useCallback, useRef } from "react";

/** 两种 StackViewport 共用的逐像素画笔缓冲；坐标投影由调用方负责。 */
export function useBrushBuffer() {
  const buffer = useRef<Uint8Array | null>(null);

  const clear = useCallback(() => {
    buffer.current = null;
  }, []);

  const paint = useCallback((
    col: number,
    row: number,
    dims: { columns: number; rows: number },
    radius: number,
    mode: "paint" | "erase",
  ) => {
    if (!buffer.current || buffer.current.length !== dims.columns * dims.rows) {
      buffer.current = new Uint8Array(dims.columns * dims.rows);
    }
    const mask = buffer.current;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > radius * radius) continue;
        const x = col + dx;
        const y = row + dy;
        if (x < 0 || x >= dims.columns || y < 0 || y >= dims.rows) continue;
        mask[y * dims.columns + x] = mode === "erase" ? 0 : 1;
      }
    }
  }, []);

  return { buffer, clear, paint };
}
