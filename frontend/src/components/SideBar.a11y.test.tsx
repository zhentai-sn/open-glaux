// 文件树键盘可达（SDD feats/05 §15 / G10）：目录行由 div 语义化为 button，带 aria-expanded，可 Tab 聚焦。
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { ExplorerView } from "./SideBar";
import { I18nProvider } from "../i18n";
import { useSession } from "../store/session";

describe("SideBar 文件树可达性", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("glaux.lang", "en");
    useSession.setState({ modality: "carotid_imt", images: [], volumes: [], slides: [] });
  });

  it("目录行渲染为 button 且带 aria-expanded", () => {
    render(
      <I18nProvider>
        <ExplorerView />
      </I18nProvider>,
    );
    // "images" 目录头默认展开，应为可聚焦 button 且 aria-expanded=true
    const dir = screen.getByRole("button", { name: /images/i });
    expect(dir).toBeInstanceOf(HTMLButtonElement);
    expect(dir).toHaveAttribute("aria-expanded", "true");
    // 点击折叠 → aria-expanded 翻转（证明键盘/点击均可触发同一 button）
    fireEvent.click(dir);
    expect(dir).toHaveAttribute("aria-expanded", "false");
  });
});
