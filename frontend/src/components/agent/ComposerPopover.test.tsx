import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n";
import { ComposerPopover } from "./ComposerPopover";

function setup(onOpen = vi.fn()) {
  render(
    <I18nProvider>
      <ComposerPopover label="模型" icon={<span aria-hidden="true">◍</span>} text="deepseek" suffix="高" onOpen={onOpen}>
        {(close) => (
          <div>
            <button type="button" onClick={close}>里面</button>
          </div>
        )}
      </ComposerPopover>
    </I18nProvider>,
  );
  return onOpen;
}

describe("ComposerPopover", () => {
  it("点击打开、点里面关闭、焦点回到触发按钮", () => {
    setup();
    const trigger = screen.getByRole("button", { name: "模型" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const inside = screen.getByRole("button", { name: "里面" });
    // 打开即聚焦第一个可聚焦元素
    expect(document.activeElement).toBe(inside);
    fireEvent.click(inside);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(trigger);
  });

  it("Esc 关闭并回到触发按钮", () => {
    setup();
    const trigger = screen.getByRole("button", { name: "模型" });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("dialog", { name: "模型" }), { key: "Escape" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(trigger);
  });

  it("点外面关闭，打开时回调一次", () => {
    const onOpen = setup();
    const trigger = screen.getByRole("button", { name: "模型" });
    fireEvent.click(trigger);
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(document.body);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});
