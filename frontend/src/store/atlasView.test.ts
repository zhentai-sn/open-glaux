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

  it("v1.0 持久化 {railOpen, stageOpen} → stageOpen 迁移为 rightOpen，rightView 补 stage（SDD 01 v1.1 §9）", async () => {
    localStorage.setItem(FOCUS_LAYOUT_KEY, JSON.stringify({ railOpen: true, stageOpen: false }));
    const { useSession } = await fresh();
    expect(useSession.getState().focusLayout).toEqual({ railOpen: true, rightOpen: false, rightView: "stage", railW: null, sideW: null });
  });

  it("rightOpen 优先于旧 stageOpen；files 为合法 rightView", async () => {
    localStorage.setItem(FOCUS_LAYOUT_KEY, JSON.stringify({ rightOpen: true, stageOpen: false, rightView: "files" }));
    const { useSession } = await fresh();
    expect(useSession.getState().focusLayout).toEqual({ railOpen: false, rightOpen: true, rightView: "files", railW: null, sideW: null });
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

describe("focusLayout 栏宽（SDD 01 v1.3 §9/§15）", () => {
  beforeEach(() => localStorage.clear());

  it("缺省 null（= 沿用默认宽度/比例）", async () => {
    const { useSession } = await fresh();
    expect(useSession.getState().focusLayout).toMatchObject({ railW: null, sideW: null });
  });

  it("越界值夹回范围，非法值回 null，不白屏", async () => {
    localStorage.setItem(
      FOCUS_LAYOUT_KEY,
      JSON.stringify({ railW: 9999, sideW: -1 }),
    );
    const { useSession } = await fresh();
    expect(useSession.getState().focusLayout).toMatchObject({ railW: 420, sideW: null });
  });

  it("合法值恢复；setFocusLayout 写回同一键", async () => {
    localStorage.setItem(FOCUS_LAYOUT_KEY, JSON.stringify({ railW: 300, sideW: 400 }));
    const { useSession } = await fresh();
    expect(useSession.getState().focusLayout).toMatchObject({ railW: 300, sideW: 400 });
    useSession.getState().setFocusLayout({ sideW: null });
    expect(JSON.parse(localStorage.getItem(FOCUS_LAYOUT_KEY)!).sideW).toBeNull();
  });
});

describe("revealExemplar", () => {
  beforeEach(() => localStorage.clear());

  it("focus 模式 → 右侧栏展开并切到图谱标签；详情指向该案例", async () => {
    const { useSession, useAtlasUi, revealExemplar } = await fresh();
    useSession.setState({ uiMode: "focus" });
    useSession.getState().setFocusLayout({ rightOpen: false, rightView: "stage" });
    revealExemplar("ex-1");
    expect(useSession.getState().focusLayout).toMatchObject({ rightView: "atlas", rightOpen: true });
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
