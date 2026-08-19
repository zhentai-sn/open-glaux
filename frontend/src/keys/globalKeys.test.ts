// 全局快捷键分发契约（SDD feats/05 §15）：工具键切换、输入焦点放行、外壳组合键、? 速查、Esc 优先级、卸载移除。
import { render } from "@testing-library/react";
import { createElement, useEffect } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { useGlobalKeys } from "./globalKeys";
import { useSession } from "../store/session";

// 挂载 hook 的测试宿主；带一个 input 供"输入焦点放行"用例聚焦。
function Harness() {
  useGlobalKeys();
  return createElement("input", { "data-testid": "inp" });
}

function press(init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(e);
  return e;
}

describe("useGlobalKeys（SDD feats/05）", () => {
  beforeEach(() => {
    localStorage.clear();
    useSession.setState({
      uiMode: "focus",
      tool: "cursor",
      shortcutSheetOpen: false,
      focusLayout: { railOpen: false, rightOpen: true, rightView: "stage" },
    });
    // 焦点归到 body（查看器上下文常态）
    (document.activeElement as HTMLElement | null)?.blur?.();
  });

  it("body 焦点下单键 L/M/R/V 切换工具", () => {
    render(createElement(Harness));
    press({ key: "l" });
    expect(useSession.getState().tool).toBe("editli");
    press({ key: "m" });
    expect(useSession.getState().tool).toBe("editma");
    press({ key: "r" });
    expect(useSession.getState().tool).toBe("roi");
    press({ key: "v" });
    expect(useSession.getState().tool).toBe("cursor");
  });

  it("输入框聚焦时同键只输入、不切换工具、不 preventDefault", () => {
    const { getByTestId } = render(createElement(Harness));
    (getByTestId("inp") as HTMLInputElement).focus();
    const e = press({ key: "l" });
    expect(useSession.getState().tool).toBe("cursor"); // 未切换
    expect(e.defaultPrevented).toBe(false);
  });

  it("输入法组合期（isComposing）放行", () => {
    render(createElement(Harness));
    press({ key: "l", isComposing: true });
    expect(useSession.getState().tool).toBe("cursor");
  });

  it("Ctrl/Cmd+Shift+M 切换模式", () => {
    render(createElement(Harness));
    press({ key: "m", metaKey: true, shiftKey: true });
    expect(useSession.getState().uiMode).toBe("workbench");
    press({ key: "m", ctrlKey: true, shiftKey: true });
    expect(useSession.getState().uiMode).toBe("focus");
  });

  it("Ctrl/Cmd+B 在 Focus 切会话栏；Cmd+\\ 切右侧栏", () => {
    render(createElement(Harness));
    press({ key: "b", metaKey: true });
    expect(useSession.getState().focusLayout.railOpen).toBe(true);
    press({ key: "\\", metaKey: true });
    expect(useSession.getState().focusLayout.rightOpen).toBe(false);
  });

  it("Workbench 下 Cmd+\\ 切底面板；Cmd+B 不接管（放行）", () => {
    useSession.setState({ uiMode: "workbench" });
    render(createElement(Harness));
    const before = useSession.getState().panelCollapsed;
    press({ key: "\\", metaKey: true });
    expect(useSession.getState().panelCollapsed).toBe(!before);
    const e = press({ key: "b", metaKey: true });
    expect(e.defaultPrevented).toBe(false); // Workbench 侧栏 dockview 自管，放行
  });

  it("? 开合速查面板；Esc 优先关面板，否则复位工具", () => {
    render(createElement(Harness));
    press({ key: "?" });
    expect(useSession.getState().shortcutSheetOpen).toBe(true);
    // 面板开时 Esc 先关面板，不动工具
    useSession.setState({ tool: "roi" });
    press({ key: "Escape" });
    expect(useSession.getState().shortcutSheetOpen).toBe(false);
    expect(useSession.getState().tool).toBe("roi");
    // 面板已关，再 Esc 复位工具
    press({ key: "Escape" });
    expect(useSession.getState().tool).toBe("reset");
  });

  it("卸载后移除监听（不再响应按键）", () => {
    // 卸载 hook 后按键不应改变 store
    function Once() {
      useEffect(() => {}, []);
      useGlobalKeys();
      return null;
    }
    const { unmount } = render(createElement(Once));
    unmount();
    press({ key: "l" });
    expect(useSession.getState().tool).toBe("cursor");
  });
});
