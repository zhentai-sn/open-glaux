import { useEffect, useRef } from "react";

import { useSession } from "../store/session";

// 影像画布（设计稿 R7）——合成 B-mode 灰度 + LI(蓝)/MA(珊瑚) + ROI(teal) + 比例尺(由 CF 算)。
// M0：静态叠加 + 坐标读出。拖拽修正 + 即时重测在 M2/F10 接入（editli/editma 手柄已画出）。
const W = 700;
const H = 470;
const CF = 0.0559;

const liBase = (x: number) => H * 0.585 + Math.sin(x / 95) * 6 + Math.sin(x / 230) * 10;
const maBase = (x: number) => liBase(x) + 16.4;
const ROI = { x0: Math.round(W * 0.12), x1: Math.round(W * 0.9) };

function buildBase(): HTMLCanvasElement {
  const base = document.createElement("canvas");
  base.width = W;
  base.height = H;
  const bx = base.getContext("2d")!;
  let s = 20240706;
  const r = () => (s = (s * 1664525 + 1013904223) & 0x7fffffff) / 0x7fffffff;
  const img = bx.createImageData(W, H);
  const d = img.data;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const li = liBase(x);
      const lt = li - 66;
      const lb = li - 6;
      let v: number;
      if (y > lt && y < lb) v = 11 + r() * 13;
      else {
        const nr = Math.exp(-((y - (li - 92)) ** 2) / 700) * 66;
        const fr = Math.exp(-((y - (li + 8)) ** 2) / 150) * 118;
        const md = Math.exp(-((y - (maBase(x) + 2)) ** 2) / 95) * 92;
        v = 24 + nr + fr + md + (r() * 44 - 8);
      }
      v = Math.max(0, Math.min(255, v + r() * r() * 44));
      d[i] = v * 0.9;
      d[i + 1] = v * 0.97;
      d[i + 2] = v;
      d[i + 3] = 255;
    }
  bx.putImageData(img, 0, 0);
  const g = bx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, W * 0.72);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,.5)");
  bx.fillStyle = g;
  bx.fillRect(0, 0, W, H);
  return base;
}

export function AnnotationCanvas() {
  const cvRef = useRef<HTMLCanvasElement>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const tool = useSession((s) => s.tool);
  const setCoords = useSession((s) => s.setCoords);

  useEffect(() => {
    if (!baseRef.current) baseRef.current = buildBase();
    const cv = cvRef.current!;
    const ctx = cv.getContext("2d")!;
    const liY = liBase;
    const maY = maBase;

    const crv = (fn: (x: number) => number, c: string, w: number) => {
      ctx.beginPath();
      for (let x = ROI.x0; x <= ROI.x1; x++) {
        const y = fn(x);
        if (x === ROI.x0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineWidth = w;
      ctx.strokeStyle = c;
      ctx.lineJoin = "round";
      ctx.shadowColor = c;
      ctx.shadowBlur = 5;
      ctx.stroke();
      ctx.shadowBlur = 0;
    };
    const handles = (fn: (x: number) => number, c: string) => {
      ctx.fillStyle = c;
      ctx.strokeStyle = "#111";
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 7; i++) {
        const x = Math.round(ROI.x0 + ((ROI.x1 - ROI.x0) * i) / 6);
        ctx.beginPath();
        ctx.arc(x, fn(x), 4.5, 0, 7);
        ctx.fill();
        ctx.stroke();
      }
    };

    ctx.drawImage(baseRef.current, 0, 0);
    // ROI 括号
    ctx.strokeStyle = "rgba(45,212,191,.8)";
    ctx.lineWidth = 1.3;
    [ROI.x0, ROI.x1].forEach((x, k) => {
      ctx.beginPath();
      ctx.moveTo(x, H * 0.42);
      ctx.lineTo(x, H * 0.84);
      ctx.stroke();
      const dd = k === 0 ? 8 : -8;
      ctx.beginPath();
      ctx.moveTo(x, H * 0.42);
      ctx.lineTo(x + dd, H * 0.42);
      ctx.moveTo(x, H * 0.84);
      ctx.lineTo(x + dd, H * 0.84);
      ctx.stroke();
    });
    ctx.fillStyle = "rgba(45,212,191,.04)";
    ctx.fillRect(ROI.x0, H * 0.42, ROI.x1 - ROI.x0, H * 0.42);
    // IMC 填充
    ctx.beginPath();
    for (let x = ROI.x0; x <= ROI.x1; x++) {
      const y = liY(x);
      if (x === ROI.x0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let x = ROI.x1; x >= ROI.x0; x--) ctx.lineTo(x, maY(x));
    ctx.closePath();
    ctx.fillStyle = "rgba(79,176,255,.09)";
    ctx.fill();
    // 边界
    crv(liY, "#4FB0FF", 1.7);
    crv(maY, "#FF8A5B", 1.7);
    if (tool === "editli") handles(liY, "#4FB0FF");
    if (tool === "editma") handles(maY, "#FF8A5B");
    // 比例尺 5mm
    const px = Math.round(5 / CF);
    const sx = W - px - 18;
    const sy = H - 20;
    ctx.strokeStyle = "rgba(230,234,240,.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + px, sy);
    ctx.moveTo(sx, sy - 4);
    ctx.lineTo(sx, sy + 4);
    ctx.moveTo(sx + px, sy - 4);
    ctx.lineTo(sx + px, sy + 4);
    ctx.stroke();
    ctx.fillStyle = "rgba(230,234,240,.9)";
    ctx.font = "10px ui-monospace,monospace";
    ctx.textAlign = "center";
    ctx.fillText("5 mm", sx + px / 2, sy - 6);
  }, [tool]);

  return (
    <div className="frame">
      <canvas
        ref={cvRef}
        width={W}
        height={H}
        onPointerMove={(e) => {
          const r = cvRef.current!.getBoundingClientRect();
          setCoords(
            Math.round(((e.clientX - r.left) * W) / r.width),
            Math.round(((e.clientY - r.top) * H) / r.height),
          );
        }}
      />
    </div>
  );
}
