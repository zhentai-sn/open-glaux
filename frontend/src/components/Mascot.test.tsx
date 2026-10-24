// 小鸮吉祥物契约（品牌皮肤 2026-10-21 / 设计 §4）：状态换图、逐帧推进、reduced-motion 不循环。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";

import { Mascot, MASCOT_TRACKS } from "./Mascot";

function sprite(container: HTMLElement): HTMLElement {
  const el = container.querySelector(".mascot");
  if (!el) throw new Error("mascot 未渲染");
  return el as HTMLElement;
}

describe("Mascot", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("按状态选图：切换 state 回到首帧", () => {
    const { container, rerender } = render(<Mascot state="idle" />);
    expect(sprite(container).dataset.state).toBe("idle");
    const idleImage = sprite(container).style.backgroundImage;

    rerender(<Mascot state="typing" />);
    expect(sprite(container).dataset.state).toBe("typing");
    expect(sprite(container).style.backgroundImage).not.toBe(idleImage);
    expect(sprite(container).style.backgroundPosition).toBe("0px 0px");
  });

  it("按帧时长推进 background-position", () => {
    const { container } = render(<Mascot state="typing" />);
    const before = sprite(container).style.backgroundPosition;
    act(() => { vi.advanceTimersByTime(MASCOT_TRACKS.typing.ms); });
    expect(sprite(container).style.backgroundPosition).not.toBe(before);
  });

  it("reduced-motion：停在第 0 帧，不推进", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const { container } = render(<Mascot state="typing" />);
    act(() => { vi.advanceTimersByTime(MASCOT_TRACKS.typing.ms * 3); });
    expect(sprite(container).style.backgroundPosition).toBe("0px 0px");
  });
});
