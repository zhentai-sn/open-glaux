import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

// 导入预览的 ROI 框选（SDD feats/03 §4.1）：候选插图是静态 PNG，用轻量 canvas 叠加画矩形即可，
// 不上 cornerstone 栈（cornerstone 是查看器引擎，导入预览没有它要解决的问题）。
// 坐标一律换算回图像像素（左上原点，[x0,y0,x1,y1] 整数），与后端 clamp_roi 契约一致。

export type Roi = [number, number, number, number];

export interface RoiPickerProps {
  src: string;
  /** 已画的框（图像像素坐标）。 */
  rois: Roi[];
  onChange: (rois: Roi[]) => void;
  /** 高亮的框索引（表单当前编辑项）。 */
  activeIndex?: number;
  onPick?: (index: number) => void;
  maxWidth?: number;
}

const MIN_PX = 4; // 小于此像素的框视为误触，不加入

function toRoi(a: { x: number; y: number }, b: { x: number; y: number }, scale: number, w: number, h: number): Roi | null {
  const x0 = Math.max(0, Math.min(w, Math.round(Math.min(a.x, b.x) / scale)));
  const y0 = Math.max(0, Math.min(h, Math.round(Math.min(a.y, b.y) / scale)));
  const x1 = Math.max(0, Math.min(w, Math.round(Math.max(a.x, b.x) / scale)));
  const y1 = Math.max(0, Math.min(h, Math.round(Math.max(a.y, b.y) / scale)));
  if (x1 - x0 < MIN_PX || y1 - y0 < MIN_PX) return null;
  return [x0, y0, x1, y1];
}

export function RoiPicker({ src, rois, onChange, activeIndex, onPick, maxWidth = 480 }: RoiPickerProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [drag, setDrag] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  useEffect(() => {
    setNat(null);
  }, [src]);

  const scale = nat ? box.w / nat.w : 1;

  const local = (e: ReactPointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!nat || e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = local(e);
    setDrag({ a: p, b: p });
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    setDrag({ a: drag.a, b: local(e) });
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag || !nat) return;
    const roi = toRoi(drag.a, local(e), scale, nat.w, nat.h);
    setDrag(null);
    if (roi) onChange([...rois, roi]);
  };

  const rectStyle = (r: Roi) => ({
    left: r[0] * scale,
    top: r[1] * scale,
    width: (r[2] - r[0]) * scale,
    height: (r[3] - r[1]) * scale,
  });

  return (
    <div
      className="atlas-roi-picker"
      style={{ maxWidth }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      data-testid="roi-picker"
    >
      <img
        ref={imgRef}
        src={src}
        alt=""
        draggable={false}
        onLoad={(e) => {
          const el = e.currentTarget;
          setNat({ w: el.naturalWidth, h: el.naturalHeight });
          setBox({ w: el.clientWidth, h: el.clientHeight });
        }}
      />
      {nat &&
        rois.map((r, i) => (
          <button
            key={i}
            type="button"
            className={"atlas-roi-rect" + (i === activeIndex ? " on" : "")}
            style={rectStyle(r)}
            title={`ROI ${i + 1}: ${r.join(",")}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              if (e.altKey || e.shiftKey) onChange(rois.filter((_, j) => j !== i));
              else onPick?.(i);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onChange(rois.filter((_, j) => j !== i));
            }}
          >
            <span>{i + 1}</span>
          </button>
        ))}
      {drag && nat && (
        <span
          className="atlas-roi-rect drawing"
          style={{
            left: Math.min(drag.a.x, drag.b.x),
            top: Math.min(drag.a.y, drag.b.y),
            width: Math.abs(drag.a.x - drag.b.x),
            height: Math.abs(drag.a.y - drag.b.y),
          }}
        />
      )}
    </div>
  );
}
