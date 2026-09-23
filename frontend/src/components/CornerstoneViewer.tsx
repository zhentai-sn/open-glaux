import { useCallback, useEffect, useMemo, useRef } from "react";

import { csUtils, type Types } from "../viewer/cornerstone";
import { activateTool } from "../viewer/csTools";
import { ImtWallHandleTool } from "../viewer/imtWallTool";
import { drawPrimitives } from "../viewer/overlay/painters";
import { annotationMaskSink } from "../viewer/maskSinks";
import { useBrushBuffer } from "../viewer/hooks/useBrushBuffer";
import { useCsStackEngine } from "../viewer/hooks/useCsStackEngine";
import { useOverlayCanvas } from "../viewer/hooks/useOverlayCanvas";
import { taskToolsFor } from "../viewer/useTaskTools";
import { frameSourceFor } from "../viewer/frameSources";
import { IDENTITY_PIXEL_MAP, pixelMapFor } from "../viewer/pixelMap";
import { api } from "../api/client";
import { loadAnnotations } from "../annotation/bridge";
import { resetCsAnnoBridge, syncCsAnnotations } from "../annotation/csAnno";
import { annotation, ToolGroupManager, utilities as csToolsUtils } from "@cornerstonejs/tools";
import type { Primitive, TaskOverlaySpec } from "../api/types";
import { mmPerPx } from "../data/objectInfo";
import { useSession } from "../store/session";
import type { EngineProps } from "./viewerProps";

// Cornerstone3D StackViewport 引擎（viewer="raster_2d"，SDD 04 T5 迁移）——
// 交互全部走统一框架：相机（Pan/Zoom）与自由标注（bbox/polygon 绘制+顶点编辑）由
// @cornerstonejs/tools 承担；IMT 壁线形变是自定义 BaseTool（ImtWallHandleTool，D-12），
// 提交仍走 /task/measure（D-14：任务绑定几何，口径不变）。
// 本组件 overlay 只画框架渲染不了的：壁线/椭圆（Detection）、比例尺、mask 叠色与画笔笔迹。
// 2D brush 宿主退化方案（T0 spike3）：CS3D segmentation 在 stack 上未打通 → 自持 mask 缓冲，
// 提交走 /annotations（kind=mask），reload 经 /annotations/{id}/mask 叠色。

const EMPTY_OVERLAYS: TaskOverlaySpec[] = [];
const SNAP_MM = [1, 2, 5, 10, 20, 50, 100];
const RE_ID = "glaux-re";
const VP_ID = "glaux-stack";
const TG_ID = "glaux-tg-raster2d";
const MASK_ALPHA = 0.5;

function clonePrims(ps: Primitive[]): Primitive[] {
  return ps.map((p) => (p.kind === "polyline" ? { ...p, points: p.points.map((q) => [...q]) } : { ...p }));
}

export function CornerstoneViewer({ object, focus }: EngineProps) {
  const imageIdRef = useRef<string | null>(null);
  const pixelMapRef = useRef(IDENTITY_PIXEL_MAP);
  const { elementRef: elRef, engineRef, viewportRef: vpRef, ready } = useCsStackEngine({
    renderingEngineId: RE_ID,
    viewportId: VP_ID,
    toolGroupId: TG_ID,
    getImageId: () => imageIdRef.current,
    pixelMap: () => pixelMapRef.current,
    toTarget: () => ({ image_id: useSession.getState().focus?.object_id ?? "" }),
  });
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const work = useRef<Primitive[]>([]);
  const { buffer: brushBuf, clear: clearBrush, paint: paintBrush } = useBrushBuffer();
  const brushDims = useRef<{ columns: number; rows: number } | null>(null);
  const brushing = useRef(false);
  const maskImgs = useRef(new Map<string, HTMLCanvasElement>()); // 已保存 mask 的着色画布缓存

  const objectId = object.id;
  const source = useMemo(() => frameSourceFor(object), [object]);
  const maskSink = useMemo(() => annotationMaskSink(objectId), [objectId]);
  const primitives = useSession((s) => s.primitives);
  const annotations = useSession((s) => s.annotations);
  const cf = mmPerPx(object);
  const tool = useSession((s) => s.tool);
  const toolOptions = useSession((s) => s.toolOptions);
  const tasks = useSession((s) => s.tasks);
  const datasources = useSession((s) => s.datasources);
  const setCoords = useSession((s) => s.setCoords);

  const { task: taskView, capabilities } = useMemo(
    () => taskToolsFor(object, tasks, datasources),
    [object, tasks, datasources],
  );
  const overlays = taskView?.overlays ?? EMPTY_OVERLAYS;
  const wallEditing = tool === "wall"; // 手柄只在壁线编辑态画（能力位由注册表限定为 IMT）

  // 像素坐标 → overlay 画布坐标（CSS px，与 worldToCanvas / pointer 同一空间）
  const projRef = useRef<(x: number, y: number) => [number, number]>(() => [0, 0]);

  // --- store.tool → ToolGroup 激活态（2D brush 走自持缓冲，不激活 CS3D BrushTool）
  useEffect(() => {
    if (!ready) return;
    const tg = ToolGroupManager.getToolGroup(TG_ID);
    if (!tg) return;
    // brush 在 raster_2d 是 overlay 自持缓冲（spike3 退化方案）→ 激活态回退 pan
    activateTool(tg, tool === "brush" ? "cursor" : tool, capabilities, toolOptions);
  }, [ready, tool, toolOptions, capabilities]);

  const sizeOverlay = useCallback(() => {
    const el = elRef.current;
    const ov = overlayRef.current;
    if (!el || !ov) return;
    const r = el.getBoundingClientRect();
    if (ov.width !== Math.round(r.width) || ov.height !== Math.round(r.height)) {
      ov.width = Math.round(r.width);
      ov.height = Math.round(r.height);
    }
  }, []);

  const drawOverlay = useCallback(() => {
    const ov = overlayRef.current;
    const vp = vpRef.current;
    const imageId = imageIdRef.current;
    if (!ov || !vp || !imageId) return;
    sizeOverlay();
    const ctx = ov.getContext("2d")!;
    ctx.clearRect(0, 0, ov.width, ov.height);

    const proj = (x: number, y: number): [number, number] => {
      const world = csUtils.imageToWorldCoords(imageId, pixelMapRef.current.toFrame(x, y) as Types.Point2) as Types.Point3;
      const [cx, cy] = vp.worldToCanvas(world);
      return [cx, cy];
    };
    projRef.current = proj;

    drawPrimitives(ctx, work.current, proj, { overlays, index: focus.index, wallEditing });

    // 已保存 mask 标注叠色（bbox/polygon 由 CS3D 标注层自渲染，此处只管 mask）
    const bd = brushDims.current;
    if (bd) {
      ctx.imageSmoothingEnabled = false;
      const [tlx, tly] = proj(0, 0);
      const [brx, bry] = proj(bd.columns, bd.rows);
      for (const a of useSession.getState().annotations) {
        if (a.primitive.kind !== "mask" || a.id.startsWith("tmp-")) continue;
        const cv = maskImgs.current.get(a.id);
        if (cv) {
          ctx.globalAlpha = MASK_ALPHA;
          ctx.drawImage(cv, tlx, tly, brx - tlx, bry - tly);
          ctx.globalAlpha = 1;
        }
      }
      // 未提交笔迹预览
      const buf = brushBuf.current;
      if (buf) {
        const off = document.createElement("canvas");
        off.width = bd.columns;
        off.height = bd.rows;
        const octx = off.getContext("2d")!;
        const img = octx.createImageData(bd.columns, bd.rows);
        for (let i = 0; i < buf.length; i++) {
          if (!buf[i]) continue;
          const o = i * 4;
          img.data[o] = 79;
          img.data[o + 1] = 176;
          img.data[o + 2] = 255;
          img.data[o + 3] = 255;
        }
        octx.putImageData(img, 0, 0);
        ctx.globalAlpha = MASK_ALPHA;
        ctx.drawImage(off, tlx, tly, brx - tlx, bry - tly);
        ctx.globalAlpha = 1;
      }
    }

    // 比例尺——按 CF 自适应取整刻度，以像素长度经投影量得屏幕长度
    if (cf && cf > 0 && imageIdRef.current) {
      const targetMm = 40;
      const barMm = SNAP_MM.reduce((best, m) => (Math.abs(m - targetMm) < Math.abs(best - targetMm) ? m : best), SNAP_MM[0]);
      const barPx = barMm / cf;
      const [ax] = proj(0, 0);
      const [bx] = proj(barPx, 0);
      const scr = Math.abs(bx - ax);
      const sx = ov.width - scr - 16;
      const sy = ov.height - 16;
      ctx.strokeStyle = "rgba(230,234,240,.85)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + scr, sy);
      ctx.moveTo(sx, sy - 4);
      ctx.lineTo(sx, sy + 4);
      ctx.moveTo(sx + scr, sy - 4);
      ctx.lineTo(sx + scr, sy + 4);
      ctx.stroke();
      ctx.fillStyle = "rgba(230,234,240,.9)";
      ctx.font = "10px ui-monospace,monospace";
      ctx.textAlign = "center";
      ctx.fillText(`${barMm} mm`, sx + scr / 2, sy - 6);
    }
  }, [cf, wallEditing, overlays, focus.index, sizeOverlay]);

  // drawOverlay 每次重渲染都会换标识（依赖 cf/overlays/工具态）——载图与标注回灌副作用
  // 不能把它放进依赖数组：那会让「切图」副作用在无关重渲染时重跑，其开头的
  // removeAllAnnotations() 会把已画/已回灌的标注整层清掉（画完的框凭空消失即源于此）。
  const drawOverlayRef = useRef(drawOverlay);
  useEffect(() => {
    drawOverlayRef.current = drawOverlay;
  }, [drawOverlay]);

  // 载图：预取尺寸 → setStack → reset 相机 → 拉标注（bbox/polygon/mask 统一面）
  useEffect(() => {
    if (!ready || !objectId) return;
    const vp = vpRef.current;
    if (!vp) return;
    // 切图清旧：CS3D 标注层 + 桥映射 + 画笔缓冲 + mask 缓存
    // （同一时刻仅一个查看器挂载，removeAllAnnotations 不会误伤其他引擎）
    try {
      annotation.state.removeAllAnnotations();
    } catch {
      /* 无标注时静默 */
    }
    resetCsAnnoBridge();
    clearBrush();
    brushDims.current = null;
    let cancelled = false;
    (async () => {
      const [imageId] = await source.imageIds();
      const dim = await source.dims();
      if (cancelled) return;
      imageIdRef.current = imageId;
      pixelMapRef.current = pixelMapFor(object, dim);
      ToolGroupManager.getToolGroup(TG_ID)?.setToolConfiguration(ImtWallHandleTool.toolName, { objectId, imageId, pixelMap: pixelMapRef.current });
      brushDims.current = pixelMapRef.current.objectDims;
      for (let t = 0; !cancelled && elRef.current && elRef.current.clientWidth === 0 && t < 30; t++) {
        await new Promise((r) => requestAnimationFrame(r));
      }
      if (cancelled) return;
      await vp.setStack([imageId]);
      vp.resetCamera();
      vp.render();
      drawOverlayRef.current();
      void loadAnnotations(objectId);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, objectId, object, source, clearBrush]);

  // store.annotations → CS3D 标注层回灌（bbox/polygon；mask 走 overlay 叠色）+ mask 着色加载
  useEffect(() => {
    if (!ready || !imageIdRef.current) return;
    const vp = vpRef.current;
    const forId = (vp as unknown as { getFrameOfReferenceUID?: () => string })?.getFrameOfReferenceUID?.() ?? "GLAUX_2D";
    if (syncCsAnnotations(annotations, imageIdRef.current, forId, forId, pixelMapRef.current))
      csToolsUtils.triggerAnnotationRenderForViewportIds([VP_ID]);
    // mask 着色画布懒加载（加载完成触发重绘）
    for (const a of annotations) {
      if (a.primitive.kind !== "mask" || a.id.startsWith("tmp-") || maskImgs.current.has(a.id)) continue;
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement("canvas");
        cv.width = img.naturalWidth;
        cv.height = img.naturalHeight;
        const c = cv.getContext("2d")!;
        c.drawImage(img, 0, 0);
        const d = c.getImageData(0, 0, cv.width, cv.height);
        for (let i = 0; i < d.data.length; i += 4) {
          if (d.data[i] > 0 || d.data[i + 1] > 0 || d.data[i + 2] > 0) {
            d.data[i] = 123;
            d.data[i + 1] = 224;
            d.data[i + 2] = 173;
            d.data[i + 3] = 255;
          } else {
            d.data[i + 3] = 0;
          }
        }
        c.putImageData(d, 0, 0);
        maskImgs.current.set(a.id, cv);
        drawOverlayRef.current();
      };
      img.src = api.annotations.maskUrl(a.id);
    }
  }, [annotations, ready]);

  // store.primitives 变化 → 同步工作副本 + 重绘（壁线拖拽中间态也走这里）
  useEffect(() => {
    work.current = clonePrims(primitives);
    drawOverlay();
  }, [primitives, drawOverlay]);

  useOverlayCanvas(ready, elRef, engineRef, vpRef, drawOverlay);

  // 坐标展示：CS3D 容器原生 mousemove → 图像 px（工具交互期间同样生效）
  useEffect(() => {
    const el = elRef.current;
    if (!ready || !el) return;
    const onMove = (e: MouseEvent) => {
      const vp = vpRef.current;
      const imageId = imageIdRef.current;
      if (!vp || !imageId) return;
      const r = el.getBoundingClientRect();
      try {
        const world = vp.canvasToWorld([e.clientX - r.left, e.clientY - r.top] as Types.Point2);
        const [ix, iy] = csUtils.worldToImageCoords(imageId, world) as Types.Point2;
        const [ox, oy] = pixelMapRef.current.toObject(ix, iy);
        setCoords(Math.round(ox), Math.round(oy));
      } catch {
        /* 视口瞬态 */
      }
    };
    el.addEventListener("mousemove", onMove);
    return () => el.removeEventListener("mousemove", onMove);
  }, [ready, setCoords]);

  // --- 2D brush 自持缓冲（spike3 退化方案）：overlay 拦指针画/擦，提交走 bridge ----
  const paintAt = useCallback(
    (clientX: number, clientY: number) => {
      const bd = brushDims.current;
      const vp = vpRef.current;
      const imageId = imageIdRef.current;
      const ov = overlayRef.current;
      if (!bd || !vp || !imageId || !ov) return;
      const r = ov.getBoundingClientRect();
      const world = vp.canvasToWorld([clientX - r.left, clientY - r.top] as Types.Point2);
      const [fx, fy] = csUtils.worldToImageCoords(imageId, world) as Types.Point2;
      const [ox, oy] = pixelMapRef.current.toObject(fx, fy);
      const col = Math.round(ox);
      const row = Math.round(oy);
      paintBrush(col, row, bd, toolOptions.brush.radius, toolOptions.brush.mode);
      drawOverlay();
    },
    [toolOptions.brush.radius, toolOptions.brush.mode, paintBrush, drawOverlay],
  );

  const onBrushDown = (e: React.PointerEvent) => {
    if (tool !== "brush") return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    brushing.current = true;
    paintAt(e.clientX, e.clientY);
  };
  const onBrushMove = (e: React.PointerEvent) => {
    if (brushing.current) paintAt(e.clientX, e.clientY);
  };
  const onBrushUp = async () => {
    if (!brushing.current) return;
    brushing.current = false;
    const buf = brushBuf.current;
    const bd = brushDims.current;
    if (!buf || !bd || !objectId || !buf.some((v) => v)) return;
    try {
      await maskSink.commit(buf, bd, {});
      clearBrush(); // 已落库，转由已保存 mask 通道渲染
      drawOverlay();
    } catch {
      // annotationBridge 已提示并回滚乐观草稿；保留笔迹供用户重试。
    }
  };

  const brushActive = tool === "brush";
  return (
    <div className="frame" style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={elRef} style={{ width: "100%", height: "100%", position: "relative" }} onContextMenu={(e) => e.preventDefault()} />
      {/* brush 态 overlay 拦指针（自持缓冲）；其余态放行给 CS3D 工具层 */}
      <canvas
        ref={overlayRef}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          cursor: brushActive ? "crosshair" : "default",
          pointerEvents: brushActive ? "auto" : "none",
          touchAction: "none",
        }}
        onPointerDown={onBrushDown}
        onPointerMove={onBrushMove}
        onPointerUp={onBrushUp}
        onPointerLeave={onBrushUp}
      />
    </div>
  );
}
