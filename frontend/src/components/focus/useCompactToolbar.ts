import { useLayoutEffect, useState, type RefObject } from "react";

// 舞台工具条放不下时收起按钮文字，只留图标（按钮 title 兜底提示）。
// 判据与当前形态无关：按「展开态所需宽度」对比容器宽度，展开/收起间不会来回抖动。
// 按钮计图标 + 标签自然宽度；绘制提示至少留 HINT_MIN；弹性占位不计；其余子项计内容宽度。
const HINT_MIN = 160;
const LABEL_GAP = 4; // 与 .focus-tool 的 gap 一致

function neededWidth(bar: HTMLElement): number {
  const style = getComputedStyle(bar);
  const gap = parseFloat(style.columnGap) || 0;
  const pad = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
  const kids = Array.from(bar.children) as HTMLElement[];
  const compact = bar.classList.contains("compact");
  let need = pad + gap * Math.max(0, kids.length - 1);
  for (const el of kids) {
    if (el.classList.contains("focus-tool")) {
      const label = el.querySelector("span");
      need += el.offsetWidth + (compact && label ? LABEL_GAP + label.scrollWidth : 0);
    } else if (el.classList.contains("focus-stage-hint")) {
      need += Math.min(el.scrollWidth, HINT_MIN);
    } else if (!el.classList.contains("focus-stage-grow")) {
      need += el.scrollWidth;
    }
  }
  return need;
}

export function useCompactToolbar(ref: RefObject<HTMLElement | null>): boolean {
  const [compact, setCompact] = useState(false);

  // 内容随工具/语言/选项段变化：每次渲染后重测（子项不多，开销可忽略）
  useLayoutEffect(() => {
    const bar = ref.current;
    if (bar) setCompact(neededWidth(bar) > bar.clientWidth);
  });

  // 容器宽度变化（拖拽分栏、窗口缩放）
  useLayoutEffect(() => {
    const bar = ref.current;
    if (!bar || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setCompact(neededWidth(bar) > bar.clientWidth));
    ro.observe(bar);
    return () => ro.disconnect();
  }, [ref]);

  return compact;
}
