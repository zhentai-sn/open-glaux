// 工作台入口开关（VITE_GLAUX_WORKBENCH）：缺省关闭——无模式切换按钮、快捷键不生效、旧偏好回落 Focus。
import { fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_GLAUX_WORKBENCH", "0");
  localStorage.clear();
  localStorage.setItem("glaux.lang", "en");
});
afterEach(() => { vi.unstubAllEnvs(); });

it("workbench off: no mode switch, Ctrl+Shift+M ignored, persisted workbench falls back to focus", async () => {
  localStorage.setItem("glaux.uiMode.v1", "workbench");
  const { useSession } = await import("./store/session");
  expect(useSession.getState().uiMode).toBe("focus");

  const { ModeSwitch } = await import("./components/focus/ModeSwitch");
  const { useGlobalKeys, SHORTCUT_ROWS } = await import("./keys/globalKeys");
  const { I18nProvider } = await import("./i18n");
  function Harness() {
    useGlobalKeys();
    return createElement(ModeSwitch);
  }
  render(createElement(I18nProvider, null, createElement(Harness)));
  expect(document.querySelector(".mode-switch")).toBeNull();

  fireEvent.keyDown(window, { key: "m", ctrlKey: true, shiftKey: true });
  expect(useSession.getState().uiMode).toBe("focus");
  useSession.getState().setUiMode("workbench");
  expect(useSession.getState().uiMode).toBe("focus");
  expect(SHORTCUT_ROWS.map((r) => r.label)).not.toContain("sc_mode");
});
