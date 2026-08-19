import { useRef, type KeyboardEvent, type PointerEvent } from "react";

// Focus 栏间拖拽分隔条（SDD feats/01 v1.3 §7-7 / §8 / D15）——受控、无领域逻辑：
// 只负责「把指针/键盘位移换算成一个夹在 [min,max] 内的新宽度」，存哪儿由调用方决定。
// side="left"：分隔条右边是被调宽度的栏（右侧栏），指针右移 → 变窄，故位移取反。

const STEP = 16; // 键盘每次调节量（←/→）

interface Props {
  /** 当前宽度（px）——键盘调节与拖拽的起点 */
  value: number;
  min: number;
  max: number;
  /** 被调栏在分隔条的哪一侧 */
  side: "left" | "right";
  label: string;
  onChange: (w: number) => void;
  /** 双击 / Home：复位默认 */
  onReset: () => void;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(v)));

export function PaneResizer({ value, min, max, side, label, onChange, onReset }: Props) {
  // 起点存 ref 而非 state：拖拽中每帧读，不需要触发渲染。
  const drag = useRef<{ x: number; w: number } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, w: value };
    // 指针捕获：拖出分隔条甚至拖到窗口外仍持续收事件，松手自动释放（免全局 listener 泄漏）。
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.classList.add("resizing");
    e.preventDefault();
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const delta = e.clientX - d.x;
    onChange(clamp(d.w + (side === "left" ? delta : -delta), min, max));
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    document.body.classList.remove("resizing");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const grow = side === "left" ? "ArrowRight" : "ArrowLeft";
    const shrink = side === "left" ? "ArrowLeft" : "ArrowRight";
    if (e.key === grow) onChange(clamp(value + STEP, min, max));
    else if (e.key === shrink) onChange(clamp(value - STEP, min, max));
    else if (e.key === "Home") onReset();
    else return;
    e.preventDefault();
  };

  return (
    <div
      className="focus-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    />
  );
}
