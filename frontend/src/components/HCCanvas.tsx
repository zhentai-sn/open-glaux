import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../api/client";
import { useSession } from "../store/session";

// 胎儿头围（HC）画布——合成颅脑图为底，叠加拟合椭圆 + 长/短轴 + 检测环点 + HC 比例尺。
// 交互：滚轮缩放（绕光标）、拖拽平移（与 IMT 画布同一交互口径）。HC 为闭合轮廓，
// 测量是椭圆周长；不做 LI/MA 式拖边界（编辑留作后续）。
export function HCCanvas() {
  const cvRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [dims, setDims] = useState({ w: 640, h: 480 });
  const view = useRef({ scale: 1, tx: 0, ty: 0 });
  const drag = useRef<{ sx: number; sy: number; tx0: number; ty0: number } | null>(null);

  const activeImage = useSession((s) => s.activeImage);
  const hc = useSession((s) => s.hcContour);
  const cf = useSession((s) => s.imageMeta?.cf ?? null);
  const setCoords = useSession((s) => s.setCoords);

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

    if (hc) {
      const { cx, cy, a, b, theta } = hc.ellipse;
      // 检测到的颅骨环点（淡）
      if (hc.points.length) {
        ctx.fillStyle = "rgba(45,212,191,.5)";
        for (const [x, y] of hc.points) {
          ctx.beginPath();
          ctx.arc(x, y, 1.3 / scale, 0, 7);
          ctx.fill();
        }
      }
      // 拟合椭圆（头围）
      ctx.beginPath();
      ctx.ellipse(cx, cy, a, b, theta, 0, Math.PI * 2);
      ctx.lineWidth = 2 / scale;
      ctx.strokeStyle = "#C39BFF";
      ctx.shadowColor = "#C39BFF";
      ctx.shadowBlur = 6 / scale;
      ctx.stroke();
      ctx.shadowBlur = 0;
      // 长轴（OFD）/ 短轴（BPD）
      const ct = Math.cos(theta);
      const st = Math.sin(theta);
      const axis = (len: number, dx: number, dy: number, color: string) => {
        ctx.beginPath();
        ctx.moveTo(cx - len * dx, cy - len * dy);
        ctx.lineTo(cx + len * dx, cy + len * dy);
        ctx.lineWidth = 1.1 / scale;
        ctx.strokeStyle = color;
        ctx.stroke();
      };
      axis(a, ct, st, "rgba(255,138,91,.85)"); // OFD 沿长轴
      axis(b, -st, ct, "rgba(79,176,255,.85)"); // BPD 沿短轴
      ctx.fillStyle = "#C39BFF";
      ctx.beginPath();
      ctx.arc(cx, cy, 3 / scale, 0, 7);
      ctx.fill();
    }

    if (cf && cf > 0) {
      const px = Math.round(10 / cf); // HC 尺度较大 → 用 10mm 刻度
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
      ctx.fillText("10 mm", sx + px / 2, sy - 6 / scale);
    }
  }, [dims, cf, hc]);

  useEffect(() => {
    draw();
  }, [draw]);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const cv = cvRef.current!;
    const r = cv.getBoundingClientRect();
    const cx = ((e.clientX - r.left) * dims.w) / r.width;
    const cy = ((e.clientY - r.top) * dims.h) / r.height;
    const v = view.current;
    const x = (cx - v.tx) / v.scale;
    const y = (cy - v.ty) / v.scale;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const ns = Math.max(1, Math.min(8, v.scale * factor));
    view.current = { scale: ns, tx: cx - x * ns, ty: cy - y * ns };
    draw();
  };

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { sx: e.clientX, sy: e.clientY, tx0: view.current.tx, ty0: view.current.ty };
    try {
      cvRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const cv = cvRef.current!;
    const r = cv.getBoundingClientRect();
    const k = dims.w / r.width;
    const px = ((e.clientX - r.left) * dims.w) / r.width;
    const py = ((e.clientY - r.top) * dims.h) / r.height;
    const v = view.current;
    setCoords(Math.round((px - v.tx) / v.scale), Math.round((py - v.ty) / v.scale));
    const d = drag.current;
    if (!d) return;
    view.current = { ...v, tx: d.tx0 + (e.clientX - d.sx) * k, ty: d.ty0 + (e.clientY - d.sy) * k };
    draw();
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <div className="frame">
      <canvas
        ref={cvRef}
        width={dims.w}
        height={dims.h}
        style={{ maxWidth: "100%", maxHeight: "72vh", cursor: drag.current ? "grabbing" : "grab", touchAction: "none" }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
    </div>
  );
}
