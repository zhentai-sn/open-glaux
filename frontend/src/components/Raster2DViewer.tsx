import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../api/client";
import type { Primitive, TaskOverlaySpec } from "../api/types";
import { useSession } from "../store/session";

// 泛型 2D 栅格查看器（viewer="raster_2d"）——真图为底，**按 primitive.kind 渲染** store.primitives，
// 颜色/可编辑性由任务注册表 overlays 决定。一套画布通吃 IMT（LI/MA 壁线）+ HC（颅骨椭圆）+
// 后续任何 raster_2d 任务：加任务不写画布代码（这消灭了最后一处 `isHC ? … : …` 分支）。
// 交互：滚轮缩放（绕光标）、拖拽平移；可编辑折线（overlay.editable + 工具 edit<role>）拖手柄
// 局部形变 → 松手走 /task/measure 权威重测（服务端为准）+ 来源翻 human + 智能体重测回话。

type Poly = Extract<Primitive, { kind: "polyline" }>;
type Ell = Extract<Primitive, { kind: "ellipse" }>;
type Pts = number[][];

const NUM_HANDLES = 9;
const EMPTY_OVERLAYS: TaskOverlaySpec[] = [];
const SNAP_MM = [1, 2, 5, 10, 20, 50, 100];

function sampleHandles(pts: Pts): number[] {
  if (pts.length <= NUM_HANDLES) return pts.map((_, i) => i);
  return Array.from({ length: NUM_HANDLES }, (_, k) =>
    Math.round((k * (pts.length - 1)) / (NUM_HANDLES - 1)),
  );
}

// 拖手柄 dy 以高斯衰减施加到邻近点（相对拖动起点基线，避免累积漂移）。
function deform(base: Pts, handleX: number, dy: number, sigma: number): Pts {
  return base.map(([x, y]) => [x, y + dy * Math.exp(-((x - handleX) ** 2) / (2 * sigma * sigma))]);
}

function meanThicknessMm(a: Pts, b: Pts, cf: number): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs(b[i][1] - a[i][1]);
  return (s / n) * cf;
}

function clonePrims(ps: Primitive[]): Primitive[] {
  return ps.map((p) => (p.kind === "polyline" ? { ...p, points: p.points.map((q) => [...q]) } : { ...p }));
}

export function Raster2DViewer() {
  const cvRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [dims, setDims] = useState({ w: 700, h: 470 });
  const view = useRef({ scale: 1, tx: 0, ty: 0 });
  const work = useRef<Primitive[]>([]);
  const drag = useRef<
    | { mode: "pan"; sx: number; sy: number; tx0: number; ty0: number }
    | { mode: "handle"; role: string; hx: number; y0: number; base: Pts; sigma: number }
    | null
  >(null);
  const [tick, setTick] = useState(0);
  const redraw = () => setTick((n) => n + 1);

  const activeImage = useSession((s) => s.activeImage);
  const primitives = useSession((s) => s.primitives);
  const cf = useSession((s) => s.imageMeta?.cf ?? null);
  const tool = useSession((s) => s.tool);
  const modality = useSession((s) => s.modality);
  const tasks = useSession((s) => s.tasks);
  const setCoords = useSession((s) => s.setCoords);
  const setImt = useSession((s) => s.setImt);

  const taskView = useMemo(() => tasks.find((t) => t.modality === modality), [tasks, modality]);
  const overlays = taskView?.overlays ?? EMPTY_OVERLAYS;
  const taskType = taskView?.task;
  const ovByRole = useMemo(() => new Map(overlays.map((o) => [o.role, o])), [overlays]);

  // 载入真实影像
  useEffect(() => {
    if (!activeImage) return;
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      view.current = { scale: 1, tx: 0, ty: 0 };
      setDims({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.src = api.imageUrl(activeImage);
  }, [activeImage]);

  // store.primitives 变化（新图/新模型/权威重测）→ 同步可变工作副本
  useEffect(() => {
    work.current = clonePrims(primitives);
    redraw();
  }, [primitives]);

  const draw = useCallback(() => {
    const cv = cvRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d")!;
    const { w, h } = dims;
    const { scale, tx, ty } = view.current;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(scale, 0, 0, scale, tx, ty);

    const img = imgRef.current;
    if (img) ctx.drawImage(img, 0, 0, w, h);
    else {
      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, w, h);
    }

    const prims = work.current;
    const polys = prims.filter((p): p is Poly => p.kind === "polyline");

    // 壁线对：前两条折线间填充淡带（IMT 观感；HC 无折线 → 不触发）。纯几何，非模态分支。
    if (polys.length >= 2 && polys[0].points.length > 1 && polys[1].points.length > 1) {
      ctx.beginPath();
      polys[0].points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      for (let i = polys[1].points.length - 1; i >= 0; i--) ctx.lineTo(polys[1].points[i][0], polys[1].points[i][1]);
      ctx.closePath();
      ctx.fillStyle = "rgba(79,176,255,.09)";
      ctx.fill();
    }

    const strokePoly = (pts: Pts, color: string) => {
      if (pts.length < 2) return;
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.lineWidth = 1.8 / scale;
      ctx.strokeStyle = color;
      ctx.lineJoin = "round";
      ctx.shadowColor = color;
      ctx.shadowBlur = 5 / scale;
      ctx.stroke();
      ctx.shadowBlur = 0;
    };
    const drawHandles = (pts: Pts, color: string) => {
      ctx.fillStyle = color;
      ctx.strokeStyle = "#111";
      ctx.lineWidth = 1.5 / scale;
      for (const i of sampleHandles(pts)) {
        const [x, y] = pts[i];
        ctx.beginPath();
        ctx.arc(x, y, 5 / scale, 0, 7);
        ctx.fill();
        ctx.stroke();
      }
    };

    for (const p of prims) {
      const ov = ovByRole.get(p.role);
      const color = ov?.color ?? "#4FB0FF";
      if (p.kind === "polyline") {
        strokePoly(p.points, color);
        if (ov?.editable && tool === `edit${p.role.toLowerCase()}`) drawHandles(p.points, color);
      } else if (p.kind === "ellipse") {
        const { cx, cy, a, b, theta } = p as Ell;
        ctx.beginPath();
        ctx.ellipse(cx, cy, a, b, theta, 0, Math.PI * 2);
        ctx.lineWidth = 2 / scale;
        ctx.strokeStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 6 / scale;
        ctx.stroke();
        ctx.shadowBlur = 0;
        // 长轴 / 短轴（OFD / BPD 观感）
        const ct = Math.cos(theta);
        const st = Math.sin(theta);
        const axis = (len: number, dx: number, dy: number, c: string) => {
          ctx.beginPath();
          ctx.moveTo(cx - len * dx, cy - len * dy);
          ctx.lineTo(cx + len * dx, cy + len * dy);
          ctx.lineWidth = 1.1 / scale;
          ctx.strokeStyle = c;
          ctx.stroke();
        };
        axis(a, ct, st, "rgba(255,138,91,.85)");
        axis(b, -st, ct, "rgba(79,176,255,.85)");
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(cx, cy, 3 / scale, 0, 7);
        ctx.fill();
      }
    }

    // 比例尺——按 CF 自适应取整刻度（去掉 IMT 5mm / HC 10mm 的硬编码分支）。
    if (cf && cf > 0) {
      const targetMm = (w * cf) / 8;
      const barMm = SNAP_MM.reduce((best, m) => (Math.abs(m - targetMm) < Math.abs(best - targetMm) ? m : best), SNAP_MM[0]);
      const px = Math.round(barMm / cf);
      const sx = w - px - 16;
      const sy = h - 16;
      ctx.strokeStyle = "rgba(230,234,240,.85)";
      ctx.lineWidth = 2 / scale;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + px, sy);
      ctx.moveTo(sx, sy - 4);
      ctx.lineTo(sx, sy + 4);
      ctx.moveTo(sx + px, sy - 4);
      ctx.lineTo(sx + px, sy + 4);
      ctx.stroke();
      ctx.fillStyle = "rgba(230,234,240,.9)";
      ctx.font = `${10 / scale}px ui-monospace,monospace`;
      ctx.textAlign = "center";
      ctx.fillText(`${barMm} mm`, sx + px / 2, sy - 6 / scale);
    }
  }, [dims, cf, tool, ovByRole]);

  useEffect(() => {
    draw();
  }, [draw, tick]);

  // client 坐标 → 图像像素坐标（先按 CSS 适配，再逆 ctx 变换）
  const toImage = (clientX: number, clientY: number) => {
    const cv = cvRef.current!;
    const r = cv.getBoundingClientRect();
    const cx = ((clientX - r.left) * dims.w) / r.width;
    const cy = ((clientY - r.top) * dims.h) / r.height;
    const { scale, tx, ty } = view.current;
    return { x: (cx - tx) / scale, y: (cy - ty) / scale };
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const p = toImage(e.clientX, e.clientY);
    const v = view.current;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const ns = Math.max(1, Math.min(8, v.scale * factor));
    const cv = cvRef.current!;
    const r = cv.getBoundingClientRect();
    const cx = ((e.clientX - r.left) * dims.w) / r.width;
    const cy = ((e.clientY - r.top) * dims.h) / r.height;
    view.current = { scale: ns, tx: cx - p.x * ns, ty: cy - p.y * ns };
    draw();
  };

  const capture = (id: number) => {
    try {
      cvRef.current?.setPointerCapture(id);
    } catch {
      /* noop */
    }
  };

  // 当前工具编辑哪个 role 的可编辑折线（约定 edit<role小写>：editli→LI, editma→MA）。
  const editingRole = (t: string): string | null => (t.startsWith("edit") ? t.slice(4).toUpperCase() : null);

  const onPointerDown = (e: React.PointerEvent) => {
    const p = toImage(e.clientX, e.clientY);
    const curTool = useSession.getState().tool;
    const role = editingRole(curTool);
    if (role) {
      const poly = work.current.find(
        (q): q is Poly => q.kind === "polyline" && q.role === role && !!ovByRole.get(role)?.editable,
      );
      if (poly) {
        const thr = 10 / view.current.scale;
        for (const i of sampleHandles(poly.points)) {
          const [hx, hy] = poly.points[i];
          if (Math.hypot(p.x - hx, p.y - hy) < thr) {
            const xs = poly.points.map((q) => q[0]);
            const sigma = ((Math.max(...xs) - Math.min(...xs)) / NUM_HANDLES) * 0.7;
            drag.current = { mode: "handle", role, hx, y0: p.y, base: poly.points.map((q) => [...q]), sigma };
            capture(e.pointerId);
            return;
          }
        }
      }
    }
    drag.current = { mode: "pan", sx: e.clientX, sy: e.clientY, tx0: view.current.tx, ty0: view.current.ty };
    capture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = toImage(e.clientX, e.clientY);
    setCoords(Math.round(p.x), Math.round(p.y));
    const d = drag.current;
    if (!d) return;
    if (d.mode === "pan") {
      const cv = cvRef.current!;
      const r = cv.getBoundingClientRect();
      const k = dims.w / r.width;
      view.current = { ...view.current, tx: d.tx0 + (e.clientX - d.sx) * k, ty: d.ty0 + (e.clientY - d.sy) * k };
      draw();
    } else if (d.mode === "handle") {
      const poly = work.current.find((q): q is Poly => q.kind === "polyline" && q.role === d.role);
      if (!poly) return;
      poly.points = deform(d.base, d.hx, p.y - d.y0, d.sigma);
      draw();
      const polys = work.current.filter((q): q is Poly => q.kind === "polyline");
      if (polys.length >= 2 && cf) setImt(meanThicknessMm(polys[0].points, polys[1].points, cf).toFixed(3)); // 即时预览
    }
  };

  const onPointerUp = async () => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.mode !== "handle" || !cf || !taskType) return;
    // 松手：走 /task/measure 权威重测（多模态通吃）+ 来源翻 human + 智能体回话。
    const edited = clonePrims(work.current);
    try {
      const meas = await api.taskMeasure(taskType, edited, cf);
      const m = meas.metrics;
      useSession.getState().setMetrics(m);
      useSession.getState().setPrimitives(edited);
      // 派生强类型态（agent 卡片 / 状态栏 / 输出栏仍读）——键存在才更新，非模态分支。
      const polys = edited.filter((q): q is Poly => q.kind === "polyline");
      const li = polys.find((q) => q.role === "LI");
      const ma = polys.find((q) => q.role === "MA");
      if (li && ma) {
        useSession.getState().setBoundaries({ li: li.points, ma: ma.points, source: "human", modelVersion: "human-corrected" });
      }
      if (m.IMT_pdm) {
        const pdm = m.IMT_pdm.value;
        useSession.getState().setMeasurement({
          mean_mm: m.IMT_mean?.value ?? 0,
          max_mm: m.IMT_max?.value ?? 0,
          pdm_mean_mm: pdm,
          n_columns: li ? li.points.length : 0,
          vs_a1_um: useSession.getState().measurement?.vs_a1_um ?? null,
        });
        useSession.getState().pushAgent({ variant: "plain", key: "remeasure", vars: { w: d.role, v: pdm.toFixed(3) } });
      }
    } catch {
      /* 后端失败保留预览值 */
    }
  };

  const cursor = editingRole(tool) ? "crosshair" : drag.current?.mode === "pan" ? "grabbing" : "grab";

  return (
    <div className="frame">
      <canvas
        ref={cvRef}
        width={dims.w}
        height={dims.h}
        style={{ maxWidth: "100%", maxHeight: "72vh", cursor, touchAction: "none" }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
    </div>
  );
}
