// Focus 右侧栏（SDD feats/01 v1.1 §15）：三标签切换只渲染一个内容；折叠成图标竖条、点图标展开到对应标签；
// 持久化 rightOpen/rightView；无活动图时舞台标签显示占位；文件标签选图后自动切舞台。
// 舞台/文件/图谱内容组件各自有测试，这里 mock 掉只验壳的行为。
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n";
import { useSession } from "../../store/session";

vi.mock("../SideBar", () => ({ ExplorerView: () => <div data-testid="files-view">files</div> }));
vi.mock("../atlas/AtlasView", () => ({ AtlasView: () => <div data-testid="atlas-view">atlas</div> }));
vi.mock("./StagePanel", () => ({
  StagePanel: () => {
    const image = useSession((s) => s.activeImage);
    return <div data-testid="stage-view">{image ? `stage:${image}` : "stage-empty"}</div>;
  },
}));

import { FocusSidePanel } from "./FocusSidePanel";

const KEY = "glaux.focusLayout.v1";

function ui() {
  return render(
    <I18nProvider>
      <FocusSidePanel />
    </I18nProvider>,
  );
}

describe("FocusSidePanel", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("glaux.lang", "en");
    useSession.setState({
      uiMode: "focus",
      focusLayout: { railOpen: false, rightOpen: true, rightView: "stage", railW: null, sideW: null },
      activeImage: null,
      activeVolume: null,
      activeSlide: null,
    });
  });

  it("三个标签只渲染当前一个；切换写 store + localStorage", () => {
    ui();
    expect(screen.getByRole("tab", { name: /Stage/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("stage-view")).toBeInTheDocument();
    expect(screen.queryByTestId("files-view")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /Files/ }));
    expect(screen.getByTestId("files-view")).toBeInTheDocument();
    expect(screen.queryByTestId("stage-view")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /Atlas/ }));
    expect(screen.getByTestId("atlas-view")).toBeInTheDocument();
    expect(useSession.getState().focusLayout.rightView).toBe("atlas");
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({ rightOpen: true, rightView: "atlas" });
  });

  it("折叠 → 40px 图标条（三个图标），点图标展开到对应标签", () => {
    ui();
    fireEvent.click(screen.getByRole("button", { name: "Collapse side panel" }));
    expect(useSession.getState().focusLayout.rightOpen).toBe(false);
    expect(screen.queryByRole("tab")).toBeNull();
    const icons = screen.getAllByRole("button");
    expect(icons).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Atlas" }));
    expect(useSession.getState().focusLayout).toMatchObject({ rightOpen: true, rightView: "atlas" });
    expect(screen.getByTestId("atlas-view")).toBeInTheDocument();
  });

  it("文件标签里选中图像 → 自动切到舞台", () => {
    useSession.setState({ focusLayout: { railOpen: false, rightOpen: true, rightView: "files", railW: null, sideW: null } });
    ui();
    expect(screen.getByTestId("files-view")).toBeInTheDocument();
    act(() => useSession.setState({ activeImage: "tech_401" }));
    expect(useSession.getState().focusLayout.rightView).toBe("stage");
    expect(screen.getByTestId("stage-view")).toHaveTextContent("stage:tech_401");
  });

  it("用户停留在图谱标签时选图不抢标签", () => {
    useSession.setState({ focusLayout: { railOpen: false, rightOpen: true, rightView: "atlas", railW: null, sideW: null } });
    ui();
    act(() => useSession.setState({ activeImage: "tech_402" }));
    expect(useSession.getState().focusLayout.rightView).toBe("atlas");
  });
});
