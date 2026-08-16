// 图谱页面 store 契约（SDD feats/03 §8 / §9 / D-14）：sidebarView 可为 atlas；
// focusLayout.rightView 缺省 stage、损坏回退 stage、设置持久化；revealExemplar 按外壳模式亮出面板。
import { beforeEach, describe, expect, it, vi } from "vitest";

const FOCUS_LAYOUT_KEY = "glaux.focusLayout.v1";

async function fresh() {
  vi.resetModules();
  const session = await import("./session");
  const atlas = await import("./atlas");
  return { useSession: session.useSession, useAtlasUi: atlas.useAtlasUi, revealExemplar: atlas.revealExemplar };
}

describe("sidebarView = atlas", () => {
  beforeEach(() => localStorage.clear());

  it("setSidebarView('atlas') 生效", async () => {
    const { useSession } = await fresh();
    useSession.getState().setSidebarView("atlas");
    expect(useSession.getState().sidebarView).toBe("atlas");
  });
});

describe("focusLayout.rightView", () => {
  beforeEach(() => localStorage.clear());

  it("缺省 stage", async () => {
    const { useSession } = await fresh();
    expect(useSession.getState().focusLayout.rightView).toBe("stage");
  });

  it("旧版持久化（无 rightView 字段）→ 补 stage，不丢其它字段", async () => {
    localStorage.setItem(FOCUS_LAYOUT_KEY, JSON.stringify({ railOpen: true, stageOpen: false }));
    const { useSession } = await fresh();
    expect(useSession.getState().focusLayout).toEqual({ railOpen: true, stageOpen: false, rightView: "stage" });
  });

  it("损坏值 → 回退 stage", async () => {
    localStorage.setItem(FOCUS_LAYOUT_KEY, JSON.stringify({ rightView: "banana" }));
    const { useSession } = await fresh();
    expect(useSession.getState().focusLayout.rightView).toBe("stage");
  });

  it("合法值 atlas → 恢复；setFocusLayout 持久化", async () => {
    localStorage.setItem(FOCUS_LAYOUT_KEY, JSON.stringify({ rightView: "atlas" }));
    const { useSession } = await fresh();
    expect(useSession.getState().focusLayout.rightView).toBe("atlas");
    useSession.getState().setFocusLayout({ rightView: "stage" });
    expect(JSON.parse(localStorage.getItem(FOCUS_LAYOUT_KEY)!).rightView).toBe("stage");
  });
});

describe("revealExemplar", () => {
  beforeEach(() => localStorage.clear());

  it("focus 模式 → 右侧切 atlas 并展开；详情指向该案例", async () => {
    const { useSession, useAtlasUi, revealExemplar } = await fresh();
    useSession.setState({ uiMode: "focus" });
    useSession.getState().setFocusLayout({ stageOpen: false, rightView: "stage" });
    revealExemplar("ex-1");
    expect(useSession.getState().focusLayout).toMatchObject({ rightView: "atlas", stageOpen: true });
    expect(useAtlasUi.getState()).toMatchObject({ screen: "detail", selectedId: "ex-1" });
  });

  it("workbench 模式 → 侧栏切 atlas", async () => {
    const { useSession, useAtlasUi, revealExemplar } = await fresh();
    useSession.setState({ uiMode: "workbench", sidebarView: "explorer" });
    revealExemplar("ex-2");
    expect(useSession.getState().sidebarView).toBe("atlas");
    expect(useAtlasUi.getState().selectedId).toBe("ex-2");
  });
});
