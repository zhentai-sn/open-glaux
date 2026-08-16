import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Enums, RenderingEngine, csReady, csUtils, preloadDims, type Types } from "../viewer/cornerstone";
import { ApiError, api } from "../api/client";
import type { Primitive, TaskOverlaySpec } from "../api/types";
import { useI18n } from "../i18n";
import { useSession } from "../store/session";

// Cornerstone3D StackViewport 引擎（viewer="raster_2d"）——CS3D 负责影像显示 + 相机（缩放/平移，
// 未来 3D/视频/窗宽窗位的基座）；上覆透明 overlay 画布，按 primitive.kind 渲染 store.primitives，
// 像素↔画布经 imageToWorldCoords/worldToCanvas 投影。语义叠加 + 编辑回流仍归我们（服务端为准），
// 不用 CS3D 标注工具（其自带测量会与 /task/measure 权威口径打架）。

type Poly = Extract<Primitive, { kind: "polyline" }>;
type Ell = Extract<Primitive, { kind: "ellipse" }>;
type Pts = number[][];

const NUM_HANDLES = 9;
const EMPTY_OVERLAYS: TaskOverlaySpec[] = [];
const SNAP_MM = [1, 2, 5, 10, 20, 50, 100];
const RE_ID = "glaux-re";
const VP_ID = "glaux-stack";

function sampleHandles(pts: Pts): number[] {
  if (pts.length <= NUM_HANDLES) return pts.map((_, i) => i);
  return Array.from({ length: NUM_HANDLES }, (_, k) => Math.round((k * (pts.length - 1)) / (NUM_HANDLES - 1)));
}
function deform(base: Pts, handleX: number, dy: number, sigma: number): Pts {
  return base.map(([x, y]) => [x, y + dy * Math.exp(-((x - handleX) ** 2) / (2 * sigma * sigma))]);
}
function clonePrims(ps: Primitive[]): Primitive[] {
  return ps.map((p) => (p.kind === "polyline" ? { ...p, points: p.points.map((q) => [...q]) } : { ...p }));
}

export function CornerstoneViewer() {
  const elRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<RenderingEngine | null>(null);
  const vpRef = useRef<Types.IStackViewport | null>(null);
  const imageIdRef = useRef<string | null>(null);
  const work = useRef<Primitive[]>([]);
  const drag = useRef<
    | { mode: "pan"; sx: number; sy: number; pan0: Types.Point2 }
    | { mode: "handle"; role: string; hx: number; y0img: number; base: Pts; sigma: number; prePrims: Primitive[] }
    | null
  >(null);
  // 单调递增的编辑请求序列号：每次 onPointerUp 拍一个 mySeq，await 之后仅当 mySeq ===
  // editSeqRef.current 才 commit / rollback。保证：
  // - 后到的响应不会盖掉先到的：fast A→B，旧的 A 响应丢弃。
  // - 后到的回滚不会盖掉先到的成功：A 失败 + B 成功，A 看到 B 已加 seq，跳过回滚。
  const editSeqRef = useRef(0);
  const [ready, setReady] = useState(false);

  const activeImage = useSession((s) => s.activeImage);
  const primitives = useSession((s) => s.primitives);
  const cf = useSession((s) => s.imageMeta?.cf ?? null);
  const tool = useSession((s) => s.tool);
  const modality = useSession((s) => s.modality);
  const tasks = useSession((s) => s.tasks);
  const setCoords = useSession((s) => s.setCoords);
  const { t } = useI18n();

  const taskView = useMemo(() => tasks.find((t) => t.modality === modality), [tasks, modality]);
  const overlays = taskView?.overlays ?? EMPTY_OVERLAYS;
  const taskType = taskView?.task;
  const ovByRole = useMemo(() => new Map(overlays.map((o) => [o.role, o])), [overlays]);

  // 像素坐标 → overlay 画布坐标（CSS px，与 worldToCanvas / pointer 同一空间）
  const projRef = useRef<(x: number, y: number) => [number, number]>(() => [0, 0]);

  // 一次性初始化 CS3D + 渲染引擎 + StackViewport
  useEffect(() => {
    let disposed = false;
    (async () => {
      await csReady();
      if (disposed || !elRef.current) return;
      const engine = new RenderingEngine(RE_ID);
      engine.enableElement({ viewportId: VP_ID, type: Enums.ViewportType.STACK, element: elRef.current });
      engineRef.current = engine;
      vpRef.current = engine.getViewport(VP_ID) as Types.IStackViewport;
      setReady(true);
    })();
    return () => {
      disposed = true;
      try {
        engineRef.current?.destroy();
      } catch {
        /* noop */
      }
      engineRef.current = null;
      vpRef.current = null;
    };
  }, []);

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
      // volume_mask 在 VolumeViewer 渲染；CornerstoneViewer 仅看 2D primitive
      if (p.kind === "volume_mask") continue;
      const color = ovByRole.get(p.role)?.color ?? "#4FB0FF";
      if (p.kind === "polyline") {
        strokePoly(p.points, color);
        if (ovByRole.get(p.role)?.editable && tool === `edit${p.role.toLowerCase()}`) drawHandles(p.points, color);
      } else if (p.kind === "ellipse") {
        const e = p as Ell;
        // 椭圆按参数采样成折线再投影（world 空间旋转/缩放由相机接管）
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
  }, [cf, tool, ovByRole, sizeOverlay]);

  // 载图：预取尺寸 → setStack → reset 相机 → 重绘
  useEffect(() => {
    if (!ready || !activeImage) return;
    const vp = vpRef.current;
    if (!vp) return;
    const imageId = `web:${api.imageUrl(activeImage)}`;
    imageIdRef.current = imageId;
    let cancelled = false;
    (async () => {
      await preloadDims(imageId);
      if (cancelled) return;
      // 等元素拿到真实宽度再 setStack，规避 CS3D 「Viewport is too small 0 …」0 宽渲染警告
      for (let t = 0; !cancelled && elRef.current && elRef.current.clientWidth === 0 && t < 30; t++) {
        await new Promise((r) => requestAnimationFrame(r));
      }
      if (cancelled) return;
      await vp.setStack([imageId]);
      vp.resetCamera();
      vp.render();
      drawOverlay();
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, activeImage, drawOverlay]);

  // store.primitives 变化 → 同步工作副本 + 重绘
  useEffect(() => {
    work.current = clonePrims(primitives);
    drawOverlay();
  }, [primitives, drawOverlay]);

  // 相机变动（缩放/平移）→ overlay 跟随
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

  // 元素尺寸变化（首次拿到真实宽高 / 窗口缩放）→ 让引擎重测并重拟合 + overlay 重绘
  useEffect(() => {
    if (!ready || !elRef.current) return;
    const el = elRef.current;
    const ro = new ResizeObserver(() => {
      const engine = engineRef.current;
      const vp = vpRef.current;
      if (!engine || !vp || el.clientWidth === 0 || el.clientHeight === 0) return; // 0 尺寸不渲染（免 CS3D 警告）
      try {
        engine.resize(true, false); // 重测画布 + 重拟合（2D 单图，refit 即可）
        vp.render();
      } catch {
        /* 尺寸瞬态 */
      }
      drawOverlay();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready, drawOverlay]);

  // overlay 像素坐标（CSS px）→ 图像像素坐标
  const toImage = (clientX: number, clientY: number): [number, number] => {
    const ov = overlayRef.current!;
    const r = ov.getBoundingClientRect();
    const vp = vpRef.current!;
    const world = vp.canvasToWorld([clientX - r.left, clientY - r.top] as Types.Point2);
    const [ix, iy] = csUtils.worldToImageCoords(imageIdRef.current!, world) as Types.Point2;
    return [ix, iy];
  };

  const capture = (id: number) => {
    try {
      overlayRef.current?.setPointerCapture(id);
    } catch {
      /* noop */
    }
  };
  const editingRole = (t: string): string | null => (t.startsWith("edit") ? t.slice(4).toUpperCase() : null);

  const onPointerDown = (e: React.PointerEvent) => {
    const vp = vpRef.current;
    if (!vp) return;
    const ov = overlayRef.current!;
    const r = ov.getBoundingClientRect();
    const curTool = useSession.getState().tool;
    const role = editingRole(curTool);
    if (role) {
      const poly = work.current.find((q): q is Poly => q.kind === "polyline" && q.role === role && !!ovByRole.get(role)?.editable);
      if (poly) {
        const cxp = e.clientX - r.left;
        const cyp = e.clientY - r.top;
        for (const i of sampleHandles(poly.points)) {
          const [hx, hy] = projRef.current(poly.points[i][0], poly.points[i][1]);
          if (Math.hypot(cxp - hx, cyp - hy) < 10) {
            const [, y0img] = toImage(e.clientX, e.clientY);
            const xs = poly.points.map((q) => q[0]);
            const sigma = ((Math.max(...xs) - Math.min(...xs)) / NUM_HANDLES) * 0.7;
            drag.current = { mode: "handle", role, hx: poly.points[i][0], y0img, base: poly.points.map((q) => [...q]), sigma, prePrims: clonePrims(work.current) };
            capture(e.pointerId);
            return;
          }
        }
      }
    }
    drag.current = { mode: "pan", sx: e.clientX, sy: e.clientY, pan0: vp.getPan() };
    capture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const vp = vpRef.current;
    if (!vp) return;
    const [ix, iy] = toImage(e.clientX, e.clientY);
    setCoords(Math.round(ix), Math.round(iy));
    const d = drag.current;
    if (!d) return;
    if (d.mode === "pan") {
      vp.setPan([d.pan0[0] + (e.clientX - d.sx), d.pan0[1] + (e.clientY - d.sy)] as Types.Point2);
      vp.render();
    } else {
      const poly = work.current.find((q): q is Poly => q.kind === "polyline" && q.role === d.role);
      if (!poly) return;
      poly.points = deform(d.base, d.hx, iy - d.y0img, d.sigma);
      drawOverlay();
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const vp = vpRef.current;
    if (!vp) return;
    const z = vp.getZoom();
    vp.setZoom(Math.max(0.2, Math.min(20, z * (e.deltaY < 0 ? 1.12 : 1 / 1.12))));
    vp.render();
  };

  const onPointerUp = async () => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.mode !== "handle" || !cf || !taskType) return;
    const mySeq = ++editSeqRef.current;
    const edited = clonePrims(work.current);
    try {
      const meas = await api.taskMeasure(taskType, edited, cf);
      if (mySeq !== editSeqRef.current) return; // 已被新编辑取代，丢弃过期响应
      const m = meas.metrics;
      const st = useSession.getState();
      st.setMetrics(m);
      st.setPrimitives(edited);
      st.setSource("human"); // 编辑后来源翻人工
    } catch (e) {
      // 服务端拒绝（校准缺失 / 解剖范围外 → 422）或网络失败（500 / 超时）→ 必须回滚到拖动前，
      // 否则画布新位置与面板旧值不一致，用户看不出修正没生效（医学测量硬伤）。
      // 序列号守卫：若本编辑之后又有新 onPointerUp 触发（editSeqRef 已递增），跳过回滚——
      // 否则晚到的失败响应会盖掉 B 修正成功后已生效的状态。
      if (mySeq !== editSeqRef.current) return;
      // 1) 还原画布工作副本 + 同步到 store（store.primitives 的 effect 会再触发一次完整同步，双保险）
      work.current = clonePrims(d.prePrims);
      useSession.getState().setPrimitives(d.prePrims);
      // 2) 显式提示（Notice 胶囊）
      const isReject = e instanceof ApiError && e.status === 422;
      const why = e instanceof ApiError ? e.message : (e instanceof Error ? e.message : String(e));
      useSession
        .getState()
        .notify("crit", t(isReject ? "measure_rejected" : "measure_failed", { w: d.role, why }));
    }
  };

  const cursor = editingRole(tool) ? "crosshair" : drag.current?.mode === "pan" ? "grabbing" : "grab";

  return (
    <div className="frame" style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={elRef} style={{ width: "100%", height: "100%", position: "relative" }} onContextMenu={(e) => e.preventDefault()} />
      <canvas
        ref={overlayRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", cursor, touchAction: "none" }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
    </div>
  );
}
