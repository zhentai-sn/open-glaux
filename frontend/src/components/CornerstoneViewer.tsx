import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Enums, RenderingEngine, csReady, csUtils, preloadDims, type Types } from "../viewer/cornerstone";
import { activateTool, createToolGroup, csToolsReady, destroyToolGroup } from "../viewer/csTools";
import { sampleHandles } from "../viewer/wallGeom";
import { api } from "../api/client";
import { loadAnnotations } from "../annotation/bridge";
import { attachCsAnnoBridge, resetCsAnnoBridge, syncCsAnnotations } from "../annotation/csAnno";
import { annotation, ToolGroupManager, utilities as csToolsUtils } from "@cornerstonejs/tools";
import type { Primitive, TaskOverlaySpec } from "../api/types";
import { useSession } from "../store/session";

// Cornerstone3D StackViewport 引擎（viewer="raster_2d"，SDD 04 T5 迁移）——
// 交互全部走统一框架：相机（Pan/Zoom）与自由标注（bbox/polygon 绘制+顶点编辑）由
// @cornerstonejs/tools 承担；IMT 壁线形变是自定义 BaseTool（ImtWallHandleTool，D-12），
// 提交仍走 /task/measure（D-14：任务绑定几何，口径不变）。
// 本组件 overlay 只画框架渲染不了的：壁线/椭圆（Detection）、比例尺、mask 叠色与画笔笔迹。
// 2D brush 宿主退化方案（T0 spike3）：CS3D segmentation 在 stack 上未打通 → 自持 mask 缓冲，
// 提交走 /annotations（kind=mask），reload 经 /annotations/{id}/mask 叠色。

type Poly = Extract<Primitive, { kind: "polyline" }>;
type Ell = Extract<Primitive, { kind: "ellipse" }>;
type Pts = number[][];

const EMPTY_OVERLAYS: TaskOverlaySpec[] = [];
const SNAP_MM = [1, 2, 5, 10, 20, 50, 100];
const RE_ID = "glaux-re";
const VP_ID = "glaux-stack";
const TG_ID = "glaux-tg-raster2d";
const MASK_ALPHA = 0.5;

function clonePrims(ps: Primitive[]): Primitive[] {
  return ps.map((p) => (p.kind === "polyline" ? { ...p, points: p.points.map((q) => [...q]) } : { ...p }));
}

/** 二值笔迹 mask → base64 PNG（white=笔画，后端 convert("L")→bool 对齐）。 */
function maskToPng(mask: Uint8Array, columns: number, rows: number): string {
  const cv = document.createElement("canvas");
  cv.width = columns;
  cv.height = rows;
  const ctx = cv.getContext("2d")!;
  const img = ctx.createImageData(columns, rows);
  for (let i = 0; i < mask.length; i++) {
    const o = i * 4;
    const v = mask[i] ? 255 : 0;
    img.data[o] = v;
    img.data[o + 1] = v;
    img.data[o + 2] = v;
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL("image/png");
}

export function CornerstoneViewer() {
  const elRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<RenderingEngine | null>(null);
  const vpRef = useRef<Types.IStackViewport | null>(null);
  const imageIdRef = useRef<string | null>(null);
  const work = useRef<Primitive[]>([]);
  const brushBuf = useRef<Uint8Array | null>(null); // 当前图像未提交的画笔笔迹
  const brushDims = useRef<{ columns: number; rows: number } | null>(null);
  const brushing = useRef(false);
  const maskImgs = useRef(new Map<string, HTMLCanvasElement>()); // 已保存 mask 的着色画布缓存
  const [ready, setReady] = useState(false);

  const activeImage = useSession((s) => s.activeImage);
  const primitives = useSession((s) => s.primitives);
  const annotations = useSession((s) => s.annotations);
  const cf = useSession((s) => s.imageMeta?.cf ?? null);
  const tool = useSession((s) => s.tool);
  const toolOptions = useSession((s) => s.toolOptions);
  const modality = useSession((s) => s.modality);
  const tasks = useSession((s) => s.tasks);
  const setCoords = useSession((s) => s.setCoords);

  const taskView = useMemo(() => tasks.find((t) => t.modality === modality), [tasks, modality]);
  const overlays = taskView?.overlays ?? EMPTY_OVERLAYS;
  const capabilities = taskView?.capabilities ?? [];
  const ovByRole = useMemo(() => new Map(overlays.map((o) => [o.role, o])), [overlays]);
  const isImt = modality === "carotid_imt";
  const wallEditing = tool === "polygon" && isImt;

  // 像素坐标 → overlay 画布坐标（CSS px，与 worldToCanvas / pointer 同一空间）
  const projRef = useRef<(x: number, y: number) => [number, number]>(() => [0, 0]);

  // --- 一次性初始化：CS3D core + tools + ToolGroup + 标注事件桥 ----------------
  useEffect(() => {
    let disposed = false;
    let detach: (() => void) | null = null;
    (async () => {
      await csReady();
      await csToolsReady();
      if (disposed || !elRef.current) return;
      const engine = new RenderingEngine(RE_ID);
      engine.enableElement({ viewportId: VP_ID, type: Enums.ViewportType.STACK, element: elRef.current });
      engineRef.current = engine;
      vpRef.current = engine.getViewport(VP_ID) as Types.IStackViewport;
      createToolGroup(TG_ID, VP_ID, RE_ID);
      // 落库目标用 store 的 activeImage（对象 id 的权威值），不从图片 URL 反推
      detach = attachCsAnnoBridge({
        getImageId: () => imageIdRef.current,
        toTarget: () => ({ image_id: useSession.getState().activeImage ?? "" }),
      });
      setReady(true);
    })();
    return () => {
      disposed = true;
      detach?.();
      destroyToolGroup(TG_ID);
      resetCsAnnoBridge();
      try {
        engineRef.current?.destroy();
      } catch {
        /* noop */
      }
      engineRef.current = null;
      vpRef.current = null;
    };
  }, []);

  // --- store.tool → ToolGroup 激活态（2D brush 走自持缓冲，不激活 CS3D BrushTool）
  useEffect(() => {
    if (!ready) return;
    const tg = ToolGroupManager.getToolGroup(TG_ID);
    if (!tg) return;
    // brush 在 raster_2d 是 overlay 自持缓冲（spike3 退化方案）→ 激活态回退 pan
    activateTool(tg, tool === "brush" ? "cursor" : tool, capabilities, toolOptions, modality);
  }, [ready, tool, toolOptions, capabilities, modality]);

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
      const world = csUtils.imageToWorldCoords(imageId, [x, y] as Types.Point2) as Types.Point3;
      const [cx, cy] = vp.worldToCanvas(world);
      return [cx, cy];
    };
    projRef.current = proj;

    const prims = work.current;
    const polys = prims.filter((p): p is Poly => p.kind === "polyline");

    // 壁线对：前两条折线间填充淡带（纯几何，HC 无折线不触发）
    if (polys.length >= 2 && polys[0].points.length > 1 && polys[1].points.length > 1) {
      ctx.beginPath();
      polys[0].points.forEach(([x, y], i) => {
        const [cx, cy] = proj(x, y);
        if (i === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      });
      for (let i = polys[1].points.length - 1; i >= 0; i--) {
        const [cx, cy] = proj(polys[1].points[i][0], polys[1].points[i][1]);
        ctx.lineTo(cx, cy);
      }
      ctx.closePath();
      ctx.fillStyle = "rgba(79,176,255,.09)";
      ctx.fill();
    }

    const strokePoly = (pts: Pts, color: string) => {
      if (pts.length < 2) return;
      ctx.beginPath();
      pts.forEach(([x, y], i) => {
        const [cx, cy] = proj(x, y);
        if (i === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      });
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = color;
      ctx.lineJoin = "round";
      ctx.shadowColor = color;
      ctx.shadowBlur = 5;
      ctx.stroke();
      ctx.shadowBlur = 0;
    };
    const drawHandles = (pts: Pts, color: string) => {
      ctx.fillStyle = color;
      ctx.strokeStyle = "#111";
      ctx.lineWidth = 1.5;
      for (const i of sampleHandles(pts)) {
        const [cx, cy] = proj(pts[i][0], pts[i][1]);
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, 7);
        ctx.fill();
        ctx.stroke();
      }
    };

    for (const p of prims) {
      if (p.kind === "volume_mask") continue; // VolumeViewer 渲染
      const color = ovByRole.get(p.role)?.color ?? "#4FB0FF";
      if (p.kind === "polyline") {
        strokePoly(p.points, color);
        // 壁线手柄：IMT polygon 态（统一框架的 ImtWallHandleTool 激活时）
        if (wallEditing && ovByRole.get(p.role)?.editable) drawHandles(p.points, color);
      } else if (p.kind === "ellipse") {
        const e = p as Ell;
        const N = 96;
        ctx.beginPath();
        for (let k = 0; k <= N; k++) {
          const t = (k / N) * Math.PI * 2;
          const ex = e.cx + e.a * Math.cos(t) * Math.cos(e.theta) - e.b * Math.sin(t) * Math.sin(e.theta);
          const ey = e.cy + e.a * Math.cos(t) * Math.sin(e.theta) + e.b * Math.sin(t) * Math.cos(e.theta);
          const [cx, cy] = proj(ex, ey);
          if (k === 0) ctx.moveTo(cx, cy);
          else ctx.lineTo(cx, cy);
        }
        ctx.lineWidth = 2;
        ctx.strokeStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 6;
        ctx.stroke();
        ctx.shadowBlur = 0;
        const drawAxis = (dx: number, dy: number, len: number, c: string) => {
          const [x0, y0] = proj(e.cx - len * dx, e.cy - len * dy);
          const [x1, y1] = proj(e.cx + len * dx, e.cy + len * dy);
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.lineWidth = 1.1;
          ctx.strokeStyle = c;
          ctx.stroke();
        };
        drawAxis(Math.cos(e.theta), Math.sin(e.theta), e.a, "rgba(255,138,91,.85)");
        drawAxis(-Math.sin(e.theta), Math.cos(e.theta), e.b, "rgba(79,176,255,.85)");
      }
    }

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
  }, [cf, wallEditing, ovByRole, sizeOverlay]);

  // drawOverlay 每次重渲染都会换标识（依赖 cf/overlays/工具态）——载图与标注回灌副作用
  // 不能把它放进依赖数组：那会让「切图」副作用在无关重渲染时重跑，其开头的
  // removeAllAnnotations() 会把已画/已回灌的标注整层清掉（画完的框凭空消失即源于此）。
  const drawOverlayRef = useRef(drawOverlay);
  useEffect(() => {
    drawOverlayRef.current = drawOverlay;
  }, [drawOverlay]);

  // 载图：预取尺寸 → setStack → reset 相机 → 拉标注（bbox/polygon/mask 统一面）
  useEffect(() => {
    if (!ready || !activeImage) return;
    const vp = vpRef.current;
    if (!vp) return;
    const imageId = `web:${api.imageUrl(activeImage)}`;
    imageIdRef.current = imageId;
    // 切图清旧：CS3D 标注层 + 桥映射 + 画笔缓冲 + mask 缓存
    // （同一时刻仅一个查看器挂载，removeAllAnnotations 不会误伤其他引擎）
    try {
      annotation.state.removeAllAnnotations();
    } catch {
      /* 无标注时静默 */
    }
    resetCsAnnoBridge();
    brushBuf.current = null;
    brushDims.current = null;
    let cancelled = false;
    (async () => {
      const dim = await preloadDims(imageId);
      if (cancelled) return;
      brushDims.current = { columns: dim.columns, rows: dim.rows };
      for (let t = 0; !cancelled && elRef.current && elRef.current.clientWidth === 0 && t < 30; t++) {
        await new Promise((r) => requestAnimationFrame(r));
      }
      if (cancelled) return;
      await vp.setStack([imageId]);
      vp.resetCamera();
      vp.render();
      drawOverlayRef.current();
      void loadAnnotations(activeImage);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, activeImage]);

  // store.annotations → CS3D 标注层回灌（bbox/polygon；mask 走 overlay 叠色）+ mask 着色加载
  useEffect(() => {
    if (!ready || !imageIdRef.current) return;
    const vp = vpRef.current;
    const forId = (vp as unknown as { getFrameOfReferenceUID?: () => string })?.getFrameOfReferenceUID?.() ?? "GLAUX_2D";
    if (syncCsAnnotations(annotations, imageIdRef.current, forId, forId))
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

  // 相机变动（缩放/平移，CS3D 工具驱动）→ overlay 跟随
  useEffect(() => {
    if (!ready) return;
    const el = elRef.current;
    if (!el) return;
    const onCam = () => drawOverlay();
    el.addEventListener(Enums.Events.CAMERA_MODIFIED, onCam);
    el.addEventListener(Enums.Events.IMAGE_RENDERED, onCam);
    return () => {
      el.removeEventListener(Enums.Events.CAMERA_MODIFIED, onCam);
      el.removeEventListener(Enums.Events.IMAGE_RENDERED, onCam);
    };
  }, [ready, drawOverlay]);

  // 元素尺寸变化 → engine.resize + overlay 重绘
  useEffect(() => {
    if (!ready || !elRef.current) return;
    const el = elRef.current;
    const ro = new ResizeObserver(() => {
      const engine = engineRef.current;
      const vp = vpRef.current;
      if (!engine || !vp || el.clientWidth === 0 || el.clientHeight === 0) return;
      try {
        engine.resize(true, false);
        vp.render();
      } catch {
        /* 尺寸瞬态 */
      }
      drawOverlay();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready, drawOverlay]);

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
        setCoords(Math.round(ix), Math.round(iy));
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
      const col = Math.round(fx);
      const row = Math.round(fy);
      if (!brushBuf.current) brushBuf.current = new Uint8Array(bd.columns * bd.rows);
      const buf = brushBuf.current;
      const rad = toolOptions.brush.radius;
      const erase = toolOptions.brush.mode === "erase";
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          if (dx * dx + dy * dy > rad * rad) continue;
          const x = col + dx;
          const y = row + dy;
          if (x < 0 || x >= bd.columns || y < 0 || y >= bd.rows) continue;
          buf[y * bd.columns + x] = erase ? 0 : 1;
        }
      }
      drawOverlay();
    },
    [toolOptions.brush.radius, toolOptions.brush.mode, drawOverlay],
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
    if (!buf || !bd || !activeImage || !buf.some((v) => v)) return;
    const png = maskToPng(buf, bd.columns, bd.rows);
    const { createAnnotation } = await import("../annotation/bridge");
    const saved = await createAnnotation({
      image_id: activeImage,
      primitive: { kind: "mask" },
      mask_png_b64: png,
    });
    if (saved) {
      brushBuf.current = null; // 已落库，转由已保存 mask 通道渲染
      drawOverlay();
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
