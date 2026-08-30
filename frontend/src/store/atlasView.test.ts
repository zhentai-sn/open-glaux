// 图谱页面 store 契约（SDD feats/03 §8 / §9 / D-14）：sidebarView 可为 atlas；
// focusLayout.browserView 缺省 null、旧 rightView 迁移、损坏回退 null、设置持久化；revealExemplar 按外壳模式亮出面板。
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

describe("focusLayout.browserView（SDD 01 v1.4 §9/§15）", () => {
  beforeEach(() => localStorage.clear());

  const EMPTY = { railOpen: false, rightOpen: true, browserView: null, browserW: null, railW: null, sideW: null };

  it("缺省 null（纯舞台）", async () => {
    const { useSession } = await fresh();
    expect(useSession.getState().focusLayout.browserView).toBeNull();
  });

  it("v1.0 持久化 {railOpen, stageOpen} → stageOpen 迁移为 rightOpen，browserView 落 null", async () => {
    localStorage.setItem(FOCUS_LAYOUT_KEY, JSON.stringify({ railOpen: true, stageOpen: false }));
    const { useSession } = await fresh();
    expect(useSession.getState().focusLayout).toEqual({ ...EMPTY, railOpen: true, rightOpen: false });
  });

  // v1.1–v1.3 的三值 rightView 迁移：舞台常驻后 "stage" 就是「没有浏览器列」。
  it("旧 rightView:'stage' → browserView null", async () => {
    localStorage.setItem(FOCUS_LAYOUT_KEY, JSON.stringify({ rightOpen: true, rightView: "stage" }));
    const { useSession } = await fresh();
    expect(useSession.getState().focusLayout).toEqual(EMPTY);
  });

  it("旧 rightView:'files'/'atlas' → 原样保留为 browserView", async () => {
    localStorage.setItem(FOCUS_LAYOUT_KEY, JSON.stringify({ rightOpen: true, stageOpen: false, rightView: "files" }));
    const { useSession } = await fresh();
    expect(useSession.getState().focusLayout).toEqual({ ...EMPTY, browserView: "files" });

    localStorage.setItem(FOCUS_LAYOUT_KEY, JSON.stringify({ rightView: "atlas" }));
    const second = await fresh();
    expect(second.useSession.getState().focusLayout.browserView).toBe("atlas");
  });

  it("损坏值 → 回退 null", async () => {
    localStorage.setItem(FOCUS_LAYOUT_KEY, JSON.stringify({ rightView: "banana" }));
    const { useSession } = await fresh();
    expect(useSession.getState().focusLayout.browserView).toBeNull();

    localStorage.setItem(FOCUS_LAYOUT_KEY, JSON.stringify({ browserView: "banana" }));
    const second = await fresh();
    expect(second.useSession.getState().focusLayout.browserView).toBeNull();
  });

  it("新字段优先于旧 rightView；setFocusLayout 持久化", async () => {
    localStorage.setItem(FOCUS_LAYOUT_KEY, JSON.stringify({ browserView: "atlas", rightView: "files" }));
    const { useSession } = await fresh();
    expect(useSession.getState().focusLayout.browserView).toBe("atlas");
    useSession.getState().setFocusLayout({ browserView: null });
    expect(JSON.parse(localStorage.getItem(FOCUS_LAYOUT_KEY)!).browserView).toBeNull();
  });

  it("browserW 越界夹回 [240,480]，非法值回 null", async () => {
    localStorage.setItem(FOCUS_LAYOUT_KEY, JSON.stringify({ browserW: 9000 }));
    expect((await fresh()).useSession.getState().focusLayout.browserW).toBe(480);

    localStorage.setItem(FOCUS_LAYOUT_KEY, JSON.stringify({ browserW: 10 }));
    expect((await fresh()).useSession.getState().focusLayout.browserW).toBe(240);

    localStorage.setItem(FOCUS_LAYOUT_KEY, JSON.stringify({ browserW: "x" }));
    expect((await fresh()).useSession.getState().focusLayout.browserW).toBeNull();
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
    useSession.getState().setFocusLayout({ rightOpen: false, browserView: null });
    revealExemplar("ex-1");
    expect(useSession.getState().focusLayout).toMatchObject({ browserView: "atlas", rightOpen: true });
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
