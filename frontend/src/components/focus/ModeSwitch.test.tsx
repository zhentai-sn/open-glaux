// 模式切换按钮（SDD feats/01 §8/§10）：点击写 store + localStorage；重复点击幂等。
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../../i18n";
import { useSession } from "../../store/session";
import { ModeSwitch } from "./ModeSwitch";

describe("ModeSwitch", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("glaux.lang", "en");
    useSession.setState({ uiMode: "focus" });
  });

  it("focus 下显示去工作台，点击切到 workbench 并持久化", () => {
    render(
      <I18nProvider>
        <ModeSwitch />
      </I18nProvider>,
    );
    const btn = screen.getByRole("button", { name: /Workbench/ });
    fireEvent.click(btn);
    expect(useSession.getState().uiMode).toBe("workbench");
    expect(localStorage.getItem("glaux.uiMode.v1")).toBe("workbench");
  });

  it("workbench 下显示去专注，点击切回 focus；往返幂等", () => {
    useSession.setState({ uiMode: "workbench" });
    render(
      <I18nProvider>
        <ModeSwitch />
      </I18nProvider>,
    );
    const btn = screen.getByRole("button", { name: /Focus/ });
    fireEvent.click(btn);
    expect(useSession.getState().uiMode).toBe("focus");
    // 文案随模式翻转，再点回去
    fireEvent.click(screen.getByRole("button", { name: /Workbench/ }));
    expect(useSession.getState().uiMode).toBe("workbench");
    expect(localStorage.getItem("glaux.uiMode.v1")).toBe("workbench");
  });
});
