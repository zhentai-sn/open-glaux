// Focus 顶栏（SDD feats/01 v1.7 §15 / D24）：只剩标识与 ⇄ 模式切换——
// 没有图像上下文 chip、主题按钮与 ⚙ 连接配置（后两者在左侧栏底部的「设置」）。
import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";

import { I18nProvider } from "../../i18n";
import { useSession } from "../../store/session";
import { FocusTopBar } from "./FocusTopBar";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("glaux.lang", "en");
  useSession.setState({ uiMode: "focus" });
});

it("只渲染标识与模式切换（vitest 开放工作台），无 chip / 主题 / 设置按钮", () => {
  const { container } = render(<I18nProvider><FocusTopBar /></I18nProvider>);
  expect(screen.getByText("Glaux")).toBeInTheDocument();
  expect(screen.getAllByRole("button")).toHaveLength(1);
  expect(screen.getByRole("button", { name: /Workbench/ })).toBeInTheDocument();
  expect(container.querySelector(".focus-ctx, .cfgpop, select")).toBeNull();
});
