// Annotorious（WSI 标注层）接线 + W3C ↔ Annotation 契约映射（SDD 04 D-10：映射在前端）。
// 依赖注意项（T0 spike）：pixi（Annotorious WebGL 层）需要 eval，`@pixi/unsafe-eval`
// 必须在 pixi 首次使用前加载——故本模块顶部静态 import，任何地方都经此模块用 Annotorious。
import "@pixi/unsafe-eval";
import "@annotorious/openseadragon/annotorious-openseadragon.css";
import { createOSDAnnotator } from "@annotorious/openseadragon";
import type OpenSeadragon from "openseadragon";

import type { Annotation, AnnotationPrimitive } from "../api/types";

// Annotorious 的 d.ts 面不全（如 createAnnotation）——以最小可用面宽松承接。
export interface OsdAnnotator {
  setDrawingEnabled(on: boolean): void;
  setDrawingTool(tool: string): void;
  setAnnotations(list: unknown[]): void;
  updateAnnotation(a: W3cAnnotation): void;
  removeAnnotation(id: string): void;
  on(event: string, cb: (a: W3cAnnotation) => void): void;
}

export interface W3cAnnotation {
  id?: string;
  target?: { selector?: { type?: string; value?: string; conformsTo?: string } };
  [k: string]: unknown;
}

export function initAnnotator(viewer: OpenSeadragon.Viewer): OsdAnnotator {
  return createOSDAnnotator(viewer) as unknown as OsdAnnotator;
}

// 框选过小判定（SDD 04 §15：<MIN_ROI px 不落库，防误触）——纯函数便于回归测试。
export const MIN_ROI = 24;
export function isRoiTooSmall(prim: AnnotationPrimitive, min = MIN_ROI): boolean {
  return prim.kind === "bbox" && (prim.x1 - prim.x0 < min || prim.y1 - prim.y0 < min);
}

// --- W3C → 契约（Annotorious 事件 → Annotation primitive）--------------------

/** FragmentSelector 的 `xywh=pixel:x,y,w,h` 或 SvgSelector polygon → 契约原语。 */
export function w3cToPrimitive(a: W3cAnnotation): AnnotationPrimitive | null {
  const sel = a.target?.selector;
  if (!sel) return null;
  if (sel.type === "FragmentSelector" && typeof sel.value === "string") {
    const m = /xywh=pixel:([\d.e+-]+),([\d.e+-]+),([\d.e+-]+),([\d.e+-]+)/.exec(sel.value);
    if (!m) return null;
    const x = Number(m[1]);
    const y = Number(m[2]);
    const w = Number(m[3]);
    const h = Number(m[4]);
    if (!(w > 0) || !(h > 0)) return null;
    return { kind: "bbox", x0: x, y0: y, x1: x + w, y1: y + h };
  }
  if (sel.type === "SvgSelector" && typeof sel.value === "string") {
    const pm = /points="([^"]+)"/.exec(sel.value);
    if (!pm) return null;
    const pts = pm[1]
      .trim()
      .split(/\s+/)
      .map((p) => p.split(",").map(Number))
      .filter((q) => q.length >= 2 && q.every((v) => Number.isFinite(v)));
    if (pts.length < 3) return null;
    return { kind: "polyline", closed: true, points: pts.map((q) => [q[0], q[1]]) };
  }
  return null;
}

// --- 契约 → W3C（store.annotations → Annotorious 渲染）------------------------

export function annotationToW3c(a: Annotation): W3cAnnotation | null {
  const p = a.primitive;
  if (p.kind === "bbox") {
    return {
      id: a.id,
      target: {
        selector: {
          type: "FragmentSelector",
          conformsTo: "http://www.w3.org/TR/media-frags/",
          value: `xywh=pixel:${p.x0},${p.y0},${p.x1 - p.x0},${p.y1 - p.y0}`,
        },
      },
    };
  }
  if (p.kind === "polyline") {
    const pts = p.points.map(([x, y]) => `${x},${y}`).join(" ");
    return {
      id: a.id,
      target: { selector: { type: "SvgSelector", value: `<svg><polygon points="${pts}"></polygon></svg>` } },
    };
  }
  return null; // mask 在 WSI 无能力位（brush 禁用），不下发
}
