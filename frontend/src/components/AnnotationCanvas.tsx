import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../api/client";
import { useSession } from "../store/session";

// 影像画布（F6 + M2/F10）——真图为底，真实 LI/MA/ROI 叠加，比例尺由真实 CF 算。
// 交互：滚轮缩放（绕光标）、cursor 工具拖拽平移、editli/editma 拖手柄改边界（高斯局部形变）
// → 拖动即时估算 IMT，松手走 /measure 权威值 + 来源翻 human + 智能体重测回话。
const NUM_HANDLES = 9;
type Pts = number[][];

function sampleHandles(pts: Pts): number[] {
  // 沿点序均匀取 NUM_HANDLES 个索引作为控制手柄。
  if (pts.length <= NUM_HANDLES) return pts.map((_, i) => i);
  return Array.from({ length: NUM_HANDLES }, (_, k) =>
    Math.round((k * (pts.length - 1)) / (NUM_HANDLES - 1)),
  );
}

// 拖手柄 dy 以高斯衰减施加到邻近点（相对拖动起点的基线，避免累积漂移）。
function deform(base: Pts, handleX: number, dy: number, sigma: number): Pts {
  return base.map(([x, y]) => [x, y + dy * Math.exp(-((x - handleX) ** 2) / (2 * sigma * sigma))]);
}

function meanThicknessMm(li: Pts, ma: Pts, cf: number): number {
  const n = Math.min(li.length, ma.length);
  if (!n) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs(ma[i][1] - li[i][1]);
  return (s / n) * cf;
}

export function AnnotationCanvas() {
  const cvRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [dims, setDims] = useState({ w: 700, h: 470 });
  const view = useRef({ scale: 1, tx: 0, ty: 0 });
  const drag = useRef<
    | { mode: "pan"; sx: number; sy: number; tx0: number; ty0: number }
    | { mode: "handle"; which: "li" | "ma"; hx: number; y0: number; base: Pts; sigma: number }
    | null
  >(null);
  const work = useRef<{ li: Pts; ma: Pts } | null>(null);
  const [, forceDraw] = useState(0);

  const activeImage = useSession((s) => s.activeImage);
  const boundaries = useSession((s) => s.boundaries);
  const cf = useSession((s) => s.imageMeta?.cf ?? null);
  const tool = useSession((s) => s.tool);
  const setCoords = useSession((s) => s.setCoords);
  const setImt = useSession((s) => s.setImt);

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

  // store 边界变化（新图/新模型/权威重测）→ 同步工作副本
  useEffect(() => {
    work.current = boundaries ? { li: boundaries.li.map((p) => [...p]), ma: boundaries.ma.map((p) => [...p]) } : null;
    forceDraw((n) => n + 1);
  }, [boundaries]);

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

    const wk = work.current;
    const poly = (pts: Pts, color: string) => {
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
    const handles = (pts: Pts, color: string) => {
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

    if (wk) {
      const { li, ma } = wk;
      if (li.length > 1 && ma.length > 1) {
        ctx.beginPath();
        li.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        for (let i = ma.length - 1; i >= 0; i--) ctx.lineTo(ma[i][0], ma[i][1]);
        ctx.closePath();
        ctx.fillStyle = "rgba(79,176,255,.09)";
        ctx.fill();
      }
      const xs = li.map((p) => p[0]);
      if (xs.length) {
        const x0 = Math.min(...xs);
        const x1 = Math.max(...xs);
        ctx.strokeStyle = "rgba(45,212,191,.75)";
        ctx.lineWidth = 1.2 / scale;
        [x0, x1].forEach((x, k) => {
          ctx.beginPath();
          ctx.moveTo(x, h * 0.28);
          ctx.lineTo(x, h * 0.92);
          ctx.stroke();
          const dd = (k === 0 ? 8 : -8) / scale;
          ctx.beginPath();
          ctx.moveTo(x, h * 0.28);
          ctx.lineTo(x + dd, h * 0.28);
          ctx.moveTo(x, h * 0.92);
          ctx.lineTo(x + dd, h * 0.92);
          ctx.stroke();
        });
      }
      poly(li, "#4FB0FF");
      poly(ma, "#FF8A5B");
      if (tool === "editli") handles(li, "#4FB0FF");
      if (tool === "editma") handles(ma, "#FF8A5B");
    }

    if (cf && cf > 0) {
      const px = Math.round(5 / cf);
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
      ctx.fillText("5 mm", sx + px / 2, sy - 6 / scale);
    }
  }, [dims, cf, tool]);

  useEffect(() => {
    draw();
  }, [draw, boundaries]);

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
    // 保持光标下的图像点不动：cx = x*scale + tx  → tx = cx - x*ns
    const cv = cvRef.current!;
    const r = cv.getBoundingClientRect();
    const cx = ((e.clientX - r.left) * dims.w) / r.width;
    const cy = ((e.clientY - r.top) * dims.h) / r.height;
    view.current = { scale: ns, tx: cx - p.x * ns, ty: cy - p.y * ns };
    draw();
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const p = toImage(e.clientX, e.clientY);
    const wk = work.current;
    const curTool = useSession.getState().tool; // 读最新工具，避免闭包过期
    if ((curTool === "editli" || curTool === "editma") && wk) {
      const pts = curTool === "editli" ? wk.li : wk.ma;
      const thr = 10 / view.current.scale;
      for (const i of sampleHandles(pts)) {
        const [hx, hy] = pts[i];
        if (Math.hypot(p.x - hx, p.y - hy) < thr) {
          const xs = pts.map((q) => q[0]);
          const sigma = ((Math.max(...xs) - Math.min(...xs)) / NUM_HANDLES) * 0.7;
          drag.current = { mode: "handle", which: curTool === "editli" ? "li" : "ma", hx, y0: p.y, base: pts.map((q) => [...q]), sigma };
          capture(e.pointerId);
          return;
        }
      }
    }
    // 否则平移
    drag.current = { mode: "pan", sx: e.clientX, sy: e.clientY, tx0: view.current.tx, ty0: view.current.ty };
    capture(e.pointerId);
  };

  // 指针捕获失败（合成事件/无活动指针）不应中断拖拽——静默兜底。
  const capture = (id: number) => {
    try {
      cvRef.current?.setPointerCapture(id);
    } catch {
      /* noop */
    }
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
    } else if (d.mode === "handle" && work.current && cf) {
      const dy = p.y - d.y0;
      const nb = deform(d.base, d.hx, dy, d.sigma);
      work.current[d.which] = nb;
      draw();
      setImt(meanThicknessMm(work.current.li, work.current.ma, cf).toFixed(3)); // 拖动即时估算（预览）
    }
  };

  const onPointerUp = async () => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.mode !== "handle" || !work.current || !cf) return;
    // 松手：走 /measure 权威值 + 来源翻 human + 智能体重测回话
    const wk = work.current;
    const which = d.which === "li" ? "LI" : "MA";
    useSession.getState().setBoundaries({ li: wk.li, ma: wk.ma, source: "human", modelVersion: "human-corrected" });
    try {
      const m = await api.measure(wk.li, wk.ma, cf);
      useSession.getState().setMeasurement({ ...m, vs_a1_um: useSession.getState().measurement?.vs_a1_um ?? null });
      useSession.getState().pushAgent({ variant: "plain", key: "remeasure", vars: { w: which, v: m.pdm_mean_mm.toFixed(3) } });
    } catch {
      /* 后端失败保留预览值 */
    }
  };

  const cursor = tool === "editli" || tool === "editma" ? "crosshair" : drag.current?.mode === "pan" ? "grabbing" : "grab";

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
