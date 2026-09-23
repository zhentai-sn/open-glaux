// W3C ↔ Annotation 契约映射测试（SDD 04 T8/D-10）——纯函数往返 + 非法输入拒绝。
import { describe, expect, it } from "vitest";

import { annotationToW3c, isRoiTooSmall, w3cToPrimitive, type W3cAnnotation } from "./wsiAnno";
import type { Annotation } from "../api/types";

function ann(primitive: Annotation["primitive"]): Annotation {
  return {
    id: "a1",
    image_id: "slide_001",
    z: null,
    primitive,
    label: "",
    class_id: null,
    status: "draft",
    source: "manual",
    seq: 1,
  };
}

describe("w3cToPrimitive", () => {
  it("FragmentSelector xywh=pixel → bbox", () => {
    const w3c: W3cAnnotation = {
      target: { selector: { type: "FragmentSelector", value: "xywh=pixel:10,20,100,80" } },
    };
    expect(w3cToPrimitive(w3c)).toEqual({ kind: "bbox", x0: 10, y0: 20, x1: 110, y1: 100 });
  });

  it("SvgSelector polygon → 闭合 polyline", () => {
    const w3c: W3cAnnotation = {
      target: { selector: { type: "SvgSelector", value: '<svg><polygon points="1,2 3,4 5,2"></polygon></svg>' } },
    };
    expect(w3cToPrimitive(w3c)).toEqual({ kind: "polyline", closed: true, points: [[1, 2], [3, 4], [5, 2]] });
  });

  it("零尺寸 bbox / 少于 3 点 polygon / 缺 selector → null", () => {
    expect(w3cToPrimitive({ target: { selector: { type: "FragmentSelector", value: "xywh=pixel:1,2,0,5" } } })).toBeNull();
    expect(w3cToPrimitive({ target: { selector: { type: "SvgSelector", value: '<svg><polygon points="1,2 3,4"></polygon></svg>' } } })).toBeNull();
    expect(w3cToPrimitive({})).toBeNull();
  });
});

describe("annotationToW3c 往返", () => {
  it("bbox 契约 → W3C → 契约 一致", () => {
    const a = ann({ kind: "bbox", x0: 10, y0: 20, x1: 110, y1: 100 });
    const w3c = annotationToW3c(a)!;
    expect(w3c.id).toBe("a1");
    expect(w3cToPrimitive(w3c)).toEqual(a.primitive);
  });

  it("闭合 polyline 契约 → W3C → 契约 一致", () => {
    const prim = { kind: "polyline" as const, closed: true as const, points: [[1, 2], [3, 4], [5, 2]] };
    const w3c = annotationToW3c(ann(prim))!;
    expect(w3cToPrimitive(w3c)).toEqual(prim);
  });

  it("mask 在 WSI 无能力位 → null（不下发 Annotorious）", () => {
    expect(annotationToW3c(ann({ kind: "mask", ref: "masks/a1.png" }))).toBeNull();
  });
});

describe("isRoiTooSmall（WSI 框选过小拦截，SDD 04 §15）", () => {
  const bbox = (x0: number, y0: number, x1: number, y1: number) => ({ kind: "bbox", x0, y0, x1, y1 } as const);
  it("任一边 < 24px → true", () => {
    expect(isRoiTooSmall(bbox(0, 0, 23, 100))).toBe(true);
    expect(isRoiTooSmall(bbox(0, 0, 100, 23))).toBe(true);
  });
  it("两边 ≥ 24px → false", () => {
    expect(isRoiTooSmall(bbox(0, 0, 24, 24))).toBe(false);
  });
  it("非 bbox 原语 → false", () => {
    expect(isRoiTooSmall({ kind: "polyline", closed: true, points: [[0, 0], [1, 0], [1, 1]] })).toBe(false);
  });
});
