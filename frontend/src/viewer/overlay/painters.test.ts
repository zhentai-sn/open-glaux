import { describe, expect, it, vi } from "vitest";

import type { Primitive } from "../../api/types";
import { drawPrimitives } from "./painters";

function canvas() {
  const calls = { strokeRect: vi.fn(), arc: vi.fn(), fill: vi.fn() };
  const context = new Proxy(calls, { get: (target, key) => key in target ? target[key as keyof typeof target] : vi.fn() }) as unknown as CanvasRenderingContext2D;
  return { context, calls };
}

describe("PAINTERS 按原语分派", () => {
  it("2D bbox 与 point_set 均有绘制路径", () => {
    const { context, calls } = canvas();
    const primitives: Primitive[] = [
      { kind: "bbox", id: "b", role: "box", x0: 1, y0: 2, x1: 11, y1: 12 },
      { kind: "point_set", id: "p", role: "points", points: [[3, 4]], point_class_ids: [1], classes: [] },
    ];
    drawPrimitives(context, primitives, (x, y) => [x * 2, y * 2], { overlays: [], index: {}, wallEditing: false });
    expect(calls.strokeRect).toHaveBeenCalledWith(2, 4, 20, 20);
    expect(calls.arc).toHaveBeenCalledWith(6, 8, 2.5, 0, Math.PI * 2);
    expect(calls.fill).toHaveBeenCalled();
  });

  it("当前索引之外的原语不绘制", () => {
    const { context, calls } = canvas();
    const bbox = { kind: "bbox", id: "other", role: "box", x0: 0, y0: 0, x1: 5, y1: 5, index: { z: 3 } } as Primitive;
    drawPrimitives(context, [bbox], (x, y) => [x, y], { overlays: [], index: { z: 2 }, wallEditing: false });
    expect(calls.strokeRect).not.toHaveBeenCalled();
  });
});
