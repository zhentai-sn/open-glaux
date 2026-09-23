// 文件树键盘可达（SDD feats/05 §15 / G10）：目录行由 div 语义化为 button，带 aria-expanded，可 Tab 聚焦。
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { dsFields } from "../test/fixtures";

import { ExplorerView } from "./SideBar";
import { I18nProvider } from "../i18n";
import { useSession } from "../store/session";

describe("SideBar 文件树可达性", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("glaux.lang", "en");
    // SDD 08：文件树只在有 active 数据源时渲染，故这里先备一个（不然进的是空态卡）
    useSession.setState({
      modality: "carotid_imt",
      objects: {},
      focus: null,
      dsState: "ready",
      datasources: [
        {
          id: "cubs-tech",
          name: "CUBS",
          modality: "carotid_imt",
          root: "/r",
          origin: "builtin",
          calibration: {},
          status: "active",
          ...dsFields("carotid_imt"),
        },
      ],
    });
  });

  it("目录行渲染为 button 且带 aria-expanded", () => {
    render(
      <I18nProvider>
        <ExplorerView />
      </I18nProvider>,
    );
    // 对象目录头默认展开，应为可聚焦 button 且 aria-expanded=true
    const dir = screen.getByRole("button", { name: /^objects$/i });
    expect(dir).toBeInstanceOf(HTMLButtonElement);
    expect(dir).toHaveAttribute("aria-expanded", "true");
    // 点击折叠 → aria-expanded 翻转（证明键盘/点击均可触发同一 button）
    fireEvent.click(dir);
    expect(dir).toHaveAttribute("aria-expanded", "false");
  });
});
