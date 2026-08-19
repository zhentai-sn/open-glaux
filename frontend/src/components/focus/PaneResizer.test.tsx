// Focus 栏间分隔条（SDD feats/01 v1.3 §15）：拖拽/键盘换算并被 [min,max] 夹住；双击与 Home 复位；
// a11y 语义（role=separator + aria-value*）。jsdom 无布局，故只验换算与语义，实际手感留人工走查。
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PaneResizer } from "./PaneResizer";

function ui(over: Partial<Parameters<typeof PaneResizer>[0]> = {}) {
  const onChange = vi.fn();
  const onReset = vi.fn();
  render(
    <PaneResizer
      value={300}
      min={280}
      max={480}
      side="right"
      label="resize"
      onChange={onChange}
      onReset={onReset}
      {...over}
    />,
  );
  const el = screen.getByRole("separator");
  // jsdom 未实现指针捕获，补桩（组件用它保证拖出边界仍收事件）。
  el.setPointerCapture = vi.fn();
  el.releasePointerCapture = vi.fn();
  el.hasPointerCapture = vi.fn(() => true);
  return { el, onChange, onReset };
}

function drag(el: HTMLElement, from: number, to: number) {
  fireEvent.pointerDown(el, { button: 0, clientX: from, pointerId: 1 });
  fireEvent.pointerMove(el, { clientX: to, pointerId: 1 });
  fireEvent.pointerUp(el, { clientX: to, pointerId: 1 });
}

describe("PaneResizer", () => {
  it("右侧栏：指针左移变宽、右移变窄", () => {
    const { el, onChange } = ui();
    drag(el, 500, 440);
    expect(onChange).toHaveBeenLastCalledWith(360);
    drag(el, 500, 520);
    expect(onChange).toHaveBeenLastCalledWith(280);
  });

  it("会话栏（side=left）方向相反", () => {
    const { el, onChange } = ui({ side: "left", value: 236, min: 200, max: 420 });
    drag(el, 100, 160);
    expect(onChange).toHaveBeenLastCalledWith(296);
  });

  it("超出范围被夹住，不会把栏拖没或吃掉对话列", () => {
    const { el, onChange } = ui();
    drag(el, 500, 0);
    expect(onChange).toHaveBeenLastCalledWith(480);
    drag(el, 500, 1200);
    expect(onChange).toHaveBeenLastCalledWith(280);
  });

  it("键盘：←/→ 每次 16px 且同样夹住；Home 复位", () => {
    const { el, onChange, onReset } = ui({ value: 290 });
    fireEvent.keyDown(el, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith(306);
    fireEvent.keyDown(el, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(280); // 290-16 → 夹到 min
    fireEvent.keyDown(el, { key: "Home" });
    expect(onReset).toHaveBeenCalled();
  });

  it("双击复位；a11y 语义齐备且可聚焦", () => {
    const { el, onReset } = ui();
    fireEvent.doubleClick(el);
    expect(onReset).toHaveBeenCalled();
    expect(el).toHaveAttribute("aria-orientation", "vertical");
    expect(el).toHaveAttribute("aria-valuenow", "300");
    expect(el).toHaveAttribute("aria-valuemin", "280");
    expect(el).toHaveAttribute("aria-valuemax", "480");
    expect(el).toHaveAttribute("tabindex", "0");
  });
});
