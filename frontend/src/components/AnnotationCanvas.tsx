import { useEffect, useRef, useState } from "react";

import { api } from "../api/client";
import { useSession } from "../store/session";

// 影像画布（F6）——真实 tiff→PNG 为底，叠加真实 LI/MA 边界点 + ROI + 比例尺（由真实 CF 算）。
// 边界是图像像素坐标；画布内部分辨率 = 图像尺寸，故 1:1 直接绘制，CSS 再等比缩放。
export function AnnotationCanvas() {
  const cvRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number }>({ w: 700, h: 470 });

  const activeImage = useSession((s) => s.activeImage);
  const boundaries = useSession((s) => s.boundaries);
  const cf = useSession((s) => s.imageMeta?.cf ?? null);
  const setCoords = useSession((s) => s.setCoords);

  // 载入真实影像
  useEffect(() => {
    if (!activeImage) return;
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setDims({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.src = api.imageUrl(activeImage);
  }, [activeImage]);

  // 绘制底图 + 叠加
  useEffect(() => {
    const cv = cvRef.current;
    const img = imgRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d")!;
    const { w, h } = dims;
    ctx.clearRect(0, 0, w, h);
    if (img) ctx.drawImage(img, 0, 0, w, h);
    else {
      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, w, h);
    }

    const poly = (pts: number[][], color: string) => {
      if (pts.length < 2) return;
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = color;
      ctx.lineJoin = "round";
      ctx.shadowColor = color;
      ctx.shadowBlur = 5;
      ctx.stroke();
      ctx.shadowBlur = 0;
    };

    if (boundaries) {
      const { li, ma } = boundaries;
      // IMC 填充
      if (li.length > 1 && ma.length > 1) {
        ctx.beginPath();
        li.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        for (let i = ma.length - 1; i >= 0; i--) ctx.lineTo(ma[i][0], ma[i][1]);
        ctx.closePath();
        ctx.fillStyle = "rgba(79,176,255,.09)";
        ctx.fill();
      }
      // ROI 括号（边界 x 范围）
      const xs = li.map((p) => p[0]);
      if (xs.length) {
        const x0 = Math.min(...xs);
        const x1 = Math.max(...xs);
        ctx.strokeStyle = "rgba(45,212,191,.75)";
        ctx.lineWidth = 1.2;
        [x0, x1].forEach((x, k) => {
          ctx.beginPath();
          ctx.moveTo(x, h * 0.28);
          ctx.lineTo(x, h * 0.92);
          ctx.stroke();
          const dd = k === 0 ? 8 : -8;
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
    }

    // 比例尺 5mm（真实 CF）
    if (cf && cf > 0) {
      const px = Math.round(5 / cf);
      const sx = w - px - 16;
      const sy = h - 16;
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
    }
  }, [dims, boundaries, cf]);

  return (
    <div className="frame">
      <canvas
        ref={cvRef}
        width={dims.w}
        height={dims.h}
        style={{ maxWidth: "100%", maxHeight: "70vh" }}
        onPointerMove={(e) => {
          const r = cvRef.current!.getBoundingClientRect();
          setCoords(
            Math.round(((e.clientX - r.left) * dims.w) / r.width),
            Math.round(((e.clientY - r.top) * dims.h) / r.height),
          );
        }}
      />
    </div>
  );
}
