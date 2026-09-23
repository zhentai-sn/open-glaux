import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { OpenSeadragon, makeWsiTileSource, makeWsiViewer } from "./openseadragon";
import { api } from "../api/client";
import { createAnnotation, loadAnnotations, patchAnnotation } from "../annotation/bridge";
import { bboxFromPoints, isRoiTooSmall, moveVertex } from "./wsiGeometry";
import { axisSize } from "../data/objectInfo";
import { useSession } from "../store/session";
import type { EngineProps } from "../components/viewerProps";
import { getT } from "../i18n";
import type { Annotation, AnnotationPrimitive, ClassSpec, Primitive } from "../api/types";

// PyramidViewer——OpenSeadragon 深缩放 + 原生 SVG 标注层 + 核质心 overlay。
//
// 关键差异 vs raster_2d/volume_3d：瓦片按需（DZI 金字塔，永不整片下发）；深缩放（不是切 z）。
// bbox/polygon 绘制与顶点编辑由 OSD 视口坐标映射承担；产物经 annotationBridge 落 /annotations，
// bbox 的 on_commit 核检测由后端派发（hook_result 回流 Detection 通道）——前端不再自持框选逻辑。
// 质心存 level-0 px，overlay 经 imageToViewerElement 跟随（只读展示，非标注）。

const NUCLEUS_R = 2.5; // 质心点半径（CSS px）

type PointSetPrim = Extract<Primitive, { kind: "point_set" }>;
type Shape = Exclude<AnnotationPrimitive, { kind: "mask" }>;
type EditDraft = { annotation: Annotation; vertex: number; primitive: Shape };

export function PyramidViewer({ object, focus }: EngineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<OpenSeadragon.Viewer | null>(null);
  const drawStart = useRef<[number, number] | null>(null);
  const polygonRef = useRef<[number, number][]>([]);
  const editRef = useRef<EditDraft | null>(null);
  const [ready, setReady] = useState(false);
  const [drawBox, setDrawBox] = useState<Shape | null>(null);
  const [polygon, setPolygon] = useState<[number, number][]>([]);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [, setViewportEpoch] = useState(0);
  const [verify, setVerify] = useState<{ f1: number; count_pred: number; count_ref: number } | null>(null);
  const [verifying, setVerifying] = useState(false);

  const objectId = object.id;
  const primitives = useSession((s) => s.primitives);
  const tool = useSession((s) => s.tool);
  // 当前 ROI = 焦点的 box 选区（level-0 px）
  const region = focus.region;
  const roi = useMemo<[number, number, number, number] | null>(
    () => (region?.kind === "box" ? [region.x0, region.y0, region.x1, region.y1] : null),
    [region],
  );
  const annotations = useSession((s) => s.annotations);
  const notify = useSession((s) => s.notify);

  const pointSet = useMemo<PointSetPrim | null>(
    () => primitives.find((p): p is PointSetPrim => p.kind === "point_set") ?? null,
    [primitives],
  );
  const classById = useMemo(() => {
    const m = new Map<number, ClassSpec>();
    for (const c of pointSet?.classes ?? []) m.set(c.class_id, c);
    return m;
  }, [pointSet]);
  const w0 = axisSize(object, "x");
  const h0 = axisSize(object, "y");
  const dims = useMemo<[number, number] | null>(() => (w0 && h0 ? [w0, h0] : null), [w0, h0]);

  // --- overlay 绘制（核质心 + ROI 框 + 计数）——所有坐标经 OSD imageToViewerElement 换算 ------
  const drawOverlay = useCallback(() => {
    const ov = overlayRef.current;
    const el = containerRef.current;
    const viewer = viewerRef.current;
    if (!ov || !el) return;
    const dpr = window.devicePixelRatio || 1;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (ov.width !== Math.round(w * dpr) || ov.height !== Math.round(h * dpr)) {
      ov.width = Math.round(w * dpr);
      ov.height = Math.round(h * dpr);
    }
    const ctx = ov.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!viewer || !viewer.world.getItemCount()) return;
    const vp = viewer.viewport;

    // 1) 核质心（level-0 px → 元素 CSS px），按 class 上色
    if (pointSet) {
      ctx.globalAlpha = 0.9;
      for (let i = 0; i < pointSet.points.length; i++) {
        const [ix, iy] = pointSet.points[i];
        const p = vp.imageToViewerElementCoordinates(new OpenSeadragon.Point(ix, iy));
        if (p.x < -4 || p.y < -4 || p.x > w + 4 || p.y > h + 4) continue; // 视口外裁剪
        const cid = pointSet.point_class_ids[i] ?? 1;
        ctx.fillStyle = classById.get(cid)?.color ?? "#7BE0AD";
        ctx.beginPath();
        ctx.arc(p.x, p.y, NUCLEUS_R, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // 2) 已跑的 ROI 框（level-0 px → 元素 px）
    if (roi) {
      const tl = vp.imageToViewerElementCoordinates(new OpenSeadragon.Point(roi[0], roi[1]));
      const br = vp.imageToViewerElementCoordinates(new OpenSeadragon.Point(roi[2], roi[3]));
      ctx.strokeStyle = "rgba(123,224,173,0.9)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
      ctx.setLineDash([]);
    }

    // 3) 计数
    if (pointSet) {
      ctx.fillStyle = "rgba(230,234,240,0.95)";
      ctx.font = "bold 12px ui-monospace,monospace";
      ctx.textAlign = "right";
      ctx.fillText(`${pointSet.points.length} 核`, w - 12, 20);
    }
  }, [pointSet, classById, roi]);

  const drawOverlayRef = useRef(drawOverlay);
  drawOverlayRef.current = drawOverlay;

  // 一次性 init OSD；SVG 标注与核叠加只用它的 level-0 坐标转换。
  useEffect(() => {
    if (!containerRef.current) return;
    const viewer = makeWsiViewer(containerRef.current);
    viewerRef.current = viewer;
    const redraw = () => {
      drawOverlayRef.current();
      setViewportEpoch((epoch) => epoch + 1);
    };
    viewer.addHandler("update-viewport", redraw);
    viewer.addHandler("animation", redraw);
    viewer.addHandler("open", redraw);
    setReady(true);
    return () => {
      try {
        viewer.destroy();
      } catch {
        /* noop */
      }
      viewerRef.current = null;
    };
  }, []);

  // 切 slide / 有 dims → open 新 tileSource + 拉取该 slide 的标注
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer || !objectId || !dims || !object.resources.tiles) return;
    viewer.open(makeWsiTileSource(object.resources.tiles, dims[0], dims[1]));
    void loadAnnotations(objectId);
  }, [ready, objectId, object.resources.tiles, dims]);

  useEffect(() => {
    polygonRef.current = [];
    setPolygon([]);
    setDrawBox(null);
  }, [tool, objectId]);

  // 元素尺寸变化 → 重绘 overlay
  useEffect(() => {
    if (!ready || !containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver(() => {
      drawOverlayRef.current();
      setViewportEpoch((epoch) => epoch + 1);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready]);

  // primitives / ROI 变 → 重绘
  useEffect(() => {
    drawOverlayRef.current();
  }, [pointSet, roi, drawOverlay]);

  const toImage = (e: { clientX: number; clientY: number }): [number, number] | null => {
    const viewer = viewerRef.current;
    const element = containerRef.current;
    if (!viewer || !element || !viewer.world.getItemCount()) return null;
    const rect = element.getBoundingClientRect();
    const p = viewer.viewport.viewerElementToImageCoordinates(
      new OpenSeadragon.Point(e.clientX - rect.left, e.clientY - rect.top),
    );
    return [Math.max(0, Math.min(w0 ?? p.x, p.x)), Math.max(0, Math.min(h0 ?? p.y, p.y))];
  };

  const toScreen = (x: number, y: number): [number, number] => {
    const viewer = viewerRef.current;
    if (!viewer || !viewer.world.getItemCount()) return [0, 0];
    const p = viewer.viewport.imageToViewerElementCoordinates(new OpenSeadragon.Point(x, y));
    return [p.x, p.y];
  };

  const commitShape = (primitive: Shape) => {
    if (isRoiTooSmall(primitive)) {
      notify("info", getT()("wsi_roi_too_small"));
      return;
    }
    void createAnnotation({ image_id: objectId, primitive }).then((saved) => {
      if (saved?.primitive.kind === "bbox") {
        const box = saved.primitive;
        useSession.getState().setRegion({ kind: "box", x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 });
      }
    });
  };

  const onShapeDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (tool !== "bbox") return;
    const point = toImage(e);
    if (!point) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawStart.current = point;
    setDrawBox(bboxFromPoints(point, point));
  };

  const onShapeMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const point = toImage(e);
    if (!point) return;
    if (editRef.current) {
      const current = editRef.current;
      const next = { ...current, primitive: moveVertex(current.annotation.primitive as Shape, current.vertex, point) };
      editRef.current = next;
      setEditDraft(next);
    } else if (drawStart.current) {
      setDrawBox(bboxFromPoints(drawStart.current, point));
    }
  };

  const onShapeUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (editRef.current) {
      const current = editRef.current;
      editRef.current = null;
      setEditDraft(null);
      void patchAnnotation(current.annotation.id, current.annotation.seq, { primitive: current.primitive }).then((saved) => {
        if (saved?.primitive.kind === "bbox" && useSession.getState().focus?.object_id === objectId) {
          const box = saved.primitive;
          useSession.getState().setRegion({ kind: "box", x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 });
        }
      });
      return;
    }
    const point = toImage(e);
    const start = drawStart.current;
    drawStart.current = null;
    setDrawBox(null);
    if (start && point) commitShape(bboxFromPoints(start, point));
  };

  const onPolygonClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (tool !== "polygon") return;
    const point = toImage(e);
    if (!point) return;
    polygonRef.current = [...polygonRef.current, point];
    setPolygon(polygonRef.current);
  };

  const onPolygonDone = (e: React.MouseEvent<SVGSVGElement>) => {
    if (tool !== "polygon") return;
    e.preventDefault();
    const points = [...polygonRef.current];
    if (points.length > 1 && Math.hypot(
      points[points.length - 1][0] - points[points.length - 2][0],
      points[points.length - 1][1] - points[points.length - 2][1],
    ) < 2) {
      points.pop();
    }
    polygonRef.current = [];
    setPolygon([]);
    if (points.length >= 3) commitShape({ kind: "polyline", closed: true, points });
  };

  const startEdit = (e: React.PointerEvent<SVGElement>, annotation: Annotation, vertex: number) => {
    if (tool !== "cursor" || annotation.primitive.kind === "mask" || annotation.id.startsWith("tmp-")) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const draft = { annotation, vertex, primitive: annotation.primitive };
    editRef.current = draft;
    setEditDraft(draft);
  };

  const onVerify = async () => {
    if (!objectId || verifying) return;
    setVerifying(true);
    try {
      const r = await api.wsiVerify(objectId);
      setVerify({ f1: r.f1, count_pred: r.count_pred, count_ref: r.count_ref });
    } catch {
      notify("crit", getT()("wsi_verify_unavailable"));
    } finally {
      setVerifying(false);
    }
  };
  const f1Tone = verify ? (verify.f1 >= 0.95 ? "good" : verify.f1 >= 0.85 ? "warn" : "bad") : "";

  const drawing = tool === "bbox" || tool === "polygon";
  // 核 overlay 只读；SVG 标注层在绘制态接管指针，光标态仅顶点手柄接管。

  return (
    <div className="frame pyramid-frame" data-drawing={drawing}>
      <div ref={containerRef} className="pyramid-osd" />
      <canvas ref={overlayRef} className="pyramid-nuclei-overlay" />
      <svg
        className="wsi-annotation-overlay"
        data-drawing={drawing}
        onPointerDown={onShapeDown}
        onPointerMove={onShapeMove}
        onPointerUp={onShapeUp}
        onPointerCancel={() => { drawStart.current = null; editRef.current = null; setDrawBox(null); setEditDraft(null); }}
        onClick={onPolygonClick}
        onDoubleClick={onPolygonDone}
      >
        {annotations.filter((annotation) => annotation.status !== "rejected" && annotation.image_id === objectId).map((annotation) => {
          const primitive = editDraft?.annotation.id === annotation.id ? editDraft.primitive : annotation.primitive;
          if (primitive.kind === "mask") return null;
          const vertices: [number, number][] = primitive.kind === "bbox"
            ? [[primitive.x0, primitive.y0], [primitive.x1, primitive.y0], [primitive.x1, primitive.y1], [primitive.x0, primitive.y1]]
            : primitive.points.map(([x, y]) => [x, y]);
          const screen = vertices.map(([x, y]) => toScreen(x, y));
          const color = annotation.status === "suggested" ? "#ffa500" : "#7be0ad";
          return (
            <g key={annotation.id}>
              {primitive.kind === "bbox" ? (
                <rect
                  x={Math.min(screen[0][0], screen[2][0])}
                  y={Math.min(screen[0][1], screen[2][1])}
                  width={Math.abs(screen[2][0] - screen[0][0])}
                  height={Math.abs(screen[2][1] - screen[0][1])}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  strokeDasharray={annotation.status === "suggested" ? "6 4" : undefined}
                />
              ) : (
                <polygon points={screen.map(([x, y]) => `${x},${y}`).join(" ")} fill="none" stroke={color} strokeWidth={2} />
              )}
              {tool === "cursor" && screen.map(([x, y], vertex) => (
                <circle
                  key={vertex}
                  cx={x}
                  cy={y}
                  r={5}
                  fill={color}
                  stroke="#111"
                  strokeWidth={1.5}
                  className="pyramid-vertex"
                  onPointerDown={(event) => startEdit(event, annotation, vertex)}
                />
              ))}
            </g>
          );
        })}
        {drawBox?.kind === "bbox" && (() => {
          const [x0, y0] = toScreen(drawBox.x0, drawBox.y0);
          const [x1, y1] = toScreen(drawBox.x1, drawBox.y1);
          return <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill="rgba(123,224,173,.12)" stroke="#7be0ad" strokeWidth={2} />;
        })()}
        {polygon.length > 0 && (
          <polyline points={polygon.map(([x, y]) => toScreen(x, y).join(",")).join(" ")} fill="none" stroke="#7be0ad" strokeWidth={2} />
        )}
      </svg>
      {/* 复现验证（右上） */}
      <div className="pyramid-verify">
        <button onClick={onVerify} disabled={verifying} className="pyramid-verify-btn">
          {getT()(verifying ? "wsi_verifying" : "wsi_verify")}
        </button>
        {verify && (
          <span className={`pyramid-verify-result ${f1Tone}`}>
            F1 {verify.f1.toFixed(2)} ({verify.count_pred}/{verify.count_ref})
          </span>
        )}
      </div>
    </div>
  );
}
