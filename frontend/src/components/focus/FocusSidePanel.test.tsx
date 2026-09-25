// Focus 右侧栏（SDD feats/01 v1.6 §15）：纯内容区——工作区是舞台或图谱（sideView），舞台态下文件是与舞台
// 左右分栏的浏览器列；入口都在左侧栏（见 SessionRail.test）；分隔条夹住文件列宽；窄屏降级回整栏互斥并恢复选图跳转。
// 舞台/文件/图谱内容组件各自有测试，这里 mock 掉只验壳的行为。
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n";
import { BROWSER_W, useSession, type FocusLayout } from "../../store/session";

vi.mock("../SideBar", () => ({ ExplorerView: () => <div data-testid="files-view">files</div> }));
vi.mock("../atlas/AtlasView", () => ({ AtlasView: () => <div data-testid="atlas-view">atlas</div> }));
vi.mock("./StagePanel", () => ({
  StagePanel: () => {
    const image = useSession((s) => s.focus?.object_id);
    return <div data-testid="stage-view">{image ? `stage:${image}` : "stage-empty"}</div>;
  },
}));

import { FocusSidePanel } from "./FocusSidePanel";

const KEY = "glaux.focusLayout.v1";
const layout = (p: Partial<FocusLayout> = {}): FocusLayout => ({
  railOpen: false,
  rightOpen: true,
  sideView: "stage",
  browserView: null,
  browserW: null,
  railW: null,
  sideW: null,
  ...p,
});

/**
 * 侧栏实测宽度由 `getBoundingClientRect` 读取——jsdom 恒返回 0，组件此时保持当前判定（默认分栏）。
 * 需要验窄屏降级或分隔条上界时，先打桩再挂载；已挂载的用 resize 事件触发重测。
 */
function stubSideWidth(px: number) {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    width: px,
    height: 600,
    top: 0,
    left: 0,
    right: px,
    bottom: 600,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

function ui() {
  return render(
    <I18nProvider>
      <FocusSidePanel />
    </I18nProvider>,
  );
}

describe("FocusSidePanel v1.4 · 舞台常驻 + 分栏", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("glaux.lang", "en");
    useSession.setState({
      uiMode: "focus",
      focusLayout: layout(),
      focus: null,
    });
  });

  it("browserView=null 时只有舞台；本栏没有标签条与按钮（入口都在左侧栏，D22）", () => {
    ui();
    expect(screen.getByTestId("stage-view")).toBeInTheDocument();
    expect(screen.queryByTestId("files-view")).toBeNull();
    expect(screen.queryByTestId("atlas-view")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("打开文件列后与舞台同屏；连续选图不关闭文件列", () => {
    ui();
    act(() => useSession.getState().setFocusLayout({ browserView: "files" }));
    expect(screen.getByTestId("files-view")).toBeInTheDocument();
    expect(screen.getByTestId("stage-view")).toBeInTheDocument();
    // D19：舞台在左、文件列贴最右缘——用文档顺序断言，DOCUMENT_POSITION_FOLLOWING = 4
    expect(
      screen.getByTestId("stage-view").compareDocumentPosition(screen.getByTestId("files-view")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    act(() => useSession.setState({ focus: { object_id: "tech_401", kind: "image", index: {}, region: null } }));
    expect(screen.getByTestId("stage-view")).toHaveTextContent("stage:tech_401");
    expect(screen.getByTestId("files-view")).toBeInTheDocument();
    expect(useSession.getState().focusLayout.browserView).toBe("files");

    act(() => useSession.setState({ focus: { object_id: "tech_402", kind: "image", index: {}, region: null } }));
    expect(screen.getByTestId("stage-view")).toHaveTextContent("stage:tech_402");
    expect(useSession.getState().focusLayout.browserView).toBe("files");
  });

  it("图谱工作区替换舞台与文件列；切回舞台时文件列恢复原开合", () => {
    useSession.setState({ focusLayout: layout({ sideView: "atlas", browserView: "files" }) });
    ui();
    expect(screen.getByTestId("atlas-view")).toBeInTheDocument();
    expect(screen.queryByTestId("stage-view")).toBeNull();
    expect(screen.queryByTestId("files-view")).toBeNull();

    act(() => useSession.getState().setFocusLayout({ sideView: "stage" }));
    expect(screen.queryByTestId("atlas-view")).toBeNull();
    expect(screen.getByTestId("stage-view")).toBeInTheDocument();
    expect(screen.getByTestId("files-view")).toBeInTheDocument();
  });

  it("rightOpen=false 时整栏不渲染（无折叠竖条）", () => {
    useSession.setState({ focusLayout: layout({ rightOpen: false }) });
    const { container } = ui();
    expect(container.querySelector(".focus-side")).toBeNull();
  });
});

describe("FocusSidePanel v1.4 · 分隔条", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("glaux.lang", "en");
    useSession.setState({ uiMode: "focus", focusLayout: layout(), focus: null });
  });

  it("浏览器列关闭时不渲染分隔条；打开后渲染", () => {
    const { rerender } = ui();
    expect(screen.queryByRole("separator")).toBeNull();
    act(() => useSession.getState().setFocusLayout({ browserView: "files" }));
    rerender(
      <I18nProvider>
        <FocusSidePanel />
      </I18nProvider>,
    );
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });

  it("上界同时受 BROWSER_W.max 与「舞台不小于 STAGE_MIN」夹住", () => {
    stubSideWidth(800); // 800 − 360 = 440 < 480，故上界取 440
    useSession.setState({ focusLayout: layout({ browserView: "files" }) });
    ui();
    const sep = screen.getByRole("separator");
    expect(sep).toHaveAttribute("aria-valuemin", String(BROWSER_W.min));
    expect(sep).toHaveAttribute("aria-valuemax", "440");
    expect(sep).toHaveAttribute("aria-valuenow", String(BROWSER_W.def));
  });

  it("宽侧栏下上界回落到 BROWSER_W.max", () => {
    stubSideWidth(1200); // 1200 − 360 = 840 > 480
    useSession.setState({ focusLayout: layout({ browserView: "files" }) });
    ui();
    expect(screen.getByRole("separator")).toHaveAttribute("aria-valuemax", String(BROWSER_W.max));
  });

  // side="right"：浏览器列在分隔条右边，故 ← 变宽、→ 变窄（与会话栏那条相反）。
  it("键盘调节写回 browserW 并持久化", () => {
    stubSideWidth(1200);
    useSession.setState({ focusLayout: layout({ browserView: "files" }) });
    ui();
    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowLeft" });
    expect(useSession.getState().focusLayout.browserW).toBe(BROWSER_W.def + 16);
    expect(JSON.parse(localStorage.getItem(KEY)!).browserW).toBe(BROWSER_W.def + 16);
  });

  it("缺省宽度即最窄（D19）", () => {
    stubSideWidth(1200);
    useSession.setState({ focusLayout: layout({ browserView: "files" }) });
    ui();
    expect(BROWSER_W.def).toBe(BROWSER_W.min);
    expect(screen.getByRole("separator")).toHaveAttribute("aria-valuenow", String(BROWSER_W.min));
  });
});

describe("FocusSidePanel v1.4 · 窄屏降级", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("glaux.lang", "en");
    useSession.setState({
      uiMode: "focus",
      focusLayout: layout({ browserView: "files" }),
      focus: null,
    });
  });

  it("侧栏 < 640px：浏览器占满整栏，舞台与分隔条让位", () => {
    stubSideWidth(500);
    ui();
    expect(screen.getByTestId("files-view")).toBeInTheDocument();
    expect(screen.queryByTestId("stage-view")).toBeNull();
    expect(screen.queryByRole("separator")).toBeNull();
  });

  it("降级态下选图自动切回舞台（D17）", () => {
    stubSideWidth(500);
    ui();
    act(() => useSession.setState({ focus: { object_id: "tech_401", kind: "image", index: {}, region: null } }));
    expect(useSession.getState().focusLayout.browserView).toBeNull();
    expect(screen.getByTestId("stage-view")).toHaveTextContent("stage:tech_401");
  });

  it("迟滞：640–663 停在降级，≥664 才恢复分栏，且 browserView 不被改写", () => {
    stubSideWidth(500);
    ui();
    expect(screen.queryByTestId("stage-view")).toBeNull();

    stubSideWidth(650); // 进入迟滞带：还不够 exit=664
    act(() => window.dispatchEvent(new Event("resize")));
    expect(screen.queryByTestId("stage-view")).toBeNull();

    stubSideWidth(700);
    act(() => window.dispatchEvent(new Event("resize")));
    expect(screen.getByTestId("stage-view")).toBeInTheDocument();
    expect(screen.getByTestId("files-view")).toBeInTheDocument();
    expect(useSession.getState().focusLayout.browserView).toBe("files");
  });
});
