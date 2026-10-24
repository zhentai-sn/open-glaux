import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TurnStats } from "../../agent/runtime/types";
import { I18nProvider } from "../../i18n";
import { useContextSection } from "../../store/contextSection";
import { useSession } from "../../store/session";
import { TurnActions } from "./TurnActions";

const turn: TurnStats = {
  started_at: Date.parse("2026-10-24T14:00:00.000Z"),
  ended_at: Date.parse("2026-10-24T14:19:32.000Z"),
  provider: "opencode",
  model: "deepseek-v4.1-flash",
  usage: { input: 5_221, output: 80, cacheRead: 0, cacheWrite: 0, cost: 0 },
  model_calls: 1,
  tool_calls: 0,
};

function setup(props: Partial<Parameters<typeof TurnActions>[0]> = {}) {
  render(
    <I18nProvider>
      <TurnActions text="Hello answer" turn={turn} turnIndex={7} endedAt={turn.ended_at} {...props} />
    </I18nProvider>,
  );
}

describe("TurnActions", () => {
  beforeEach(() => {
    localStorage.setItem("glaux.lang", "zh");
    useContextSection.setState({ focusTurn: null });
    useSession.setState({ uiMode: "focus" });
  });

  it("复制本轮回答并提示", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const notify = vi.fn();
    useSession.setState({ notify });
    setup();
    fireEvent.click(screen.getByRole("button", { name: "复制" }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("Hello answer"));
    expect(notify).toHaveBeenCalledWith("info", "已复制此轮回答");
  });

  it("赞踩可切换、互斥，只落本地状态", () => {
    setup();
    const up = screen.getByRole("button", { name: "有帮助" });
    const down = screen.getByRole("button", { name: "没帮助" });
    fireEvent.click(up);
    expect(up).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(down);
    expect(down).toHaveAttribute("aria-pressed", "true");
    expect(up).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(down);
    expect(down).toHaveAttribute("aria-pressed", "false");
  });

  it("定位本轮：打开上下文视图中轨迹页并带上轮次号", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "在上下文视图中查看此轮" }));
    expect(useContextSection.getState().section).toBe("trajectory");
    expect(useContextSection.getState().focusTurn).toBe(7);
    expect(useSession.getState().focusLayout).toMatchObject({ rightOpen: true, sideView: "context" });
  });

  it("本轮用量弹层给总量、身份与缓存明细", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "本轮用量" }));
    expect(screen.getByText("本轮用量")).toBeInTheDocument();
    expect(screen.getByText("5,301 tok")).toBeInTheDocument();
    expect(screen.getByText("opencode/deepseek-v4.1-flash")).toBeInTheDocument();
    expect(screen.getByText("5,221 tok")).toBeInTheDocument();
    expect(screen.getByText("80 tok")).toBeInTheDocument();
  });

  it("没有轮次统计时不显示用量，时间戳仍在", () => {
    setup({ turn: null });
    expect(screen.queryByRole("button", { name: "本轮用量" })).toBeNull();
    expect(screen.getByText(/\d{2}:\d{2}/u)).toBeInTheDocument();
  });
});
