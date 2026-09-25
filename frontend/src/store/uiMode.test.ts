// 双模式外壳 store 契约（SDD feats/01 §9/§6.3-5 · 验收 §15）：
// uiMode 缺省/合法/损坏回退、setUiMode 持久化与幂等、focusLayout 损坏回退。
// store 为模块级单例（loadUiMode 在 import 时执行），故用 resetModules + 动态 import 取新实例。
import { beforeEach, describe, expect, it, vi } from "vitest";

const UIMODE_KEY = "glaux.uiMode.v1";
const FOCUS_LAYOUT_KEY = "glaux.focusLayout.v1";

async function freshStore() {
  vi.resetModules();
  const mod = await import("./session");
  return mod.useSession;
}

describe("uiMode（SDD feats/01）", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("无持久化键 → 默认 focus（D2：默认值即产品立场）", async () => {
    const useSession = await freshStore();
    expect(useSession.getState().uiMode).toBe("focus");
  });

  it("合法值 workbench → 恢复 workbench", async () => {
    localStorage.setItem(UIMODE_KEY, "workbench");
    const useSession = await freshStore();
    expect(useSession.getState().uiMode).toBe("workbench");
  });

  it("损坏值 → 回退 focus，不抛错", async () => {
    localStorage.setItem(UIMODE_KEY, "banana");
    const useSession = await freshStore();
    expect(useSession.getState().uiMode).toBe("focus");
  });

  it("setUiMode 写 store + localStorage；重复设置幂等", async () => {
    const useSession = await freshStore();
    useSession.getState().setUiMode("workbench");
    expect(useSession.getState().uiMode).toBe("workbench");
    expect(localStorage.getItem(UIMODE_KEY)).toBe("workbench");
    useSession.getState().setUiMode("workbench");
    expect(useSession.getState().uiMode).toBe("workbench");
    useSession.getState().setUiMode("focus");
    expect(localStorage.getItem(UIMODE_KEY)).toBe("focus");
  });
});

describe("focusLayout（SDD feats/01 §9）", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("缺省 → {railOpen:false, stageOpen:true}", async () => {
    const useSession = await freshStore();
    expect(useSession.getState().focusLayout).toEqual({ railOpen: false, rightOpen: true, sideView: "stage", browserView: null, browserW: null, railW: null, sideW: null });
  });

  it("损坏 JSON → 回退默认，不抛错", async () => {
    localStorage.setItem(FOCUS_LAYOUT_KEY, "{not json");
    const useSession = await freshStore();
    expect(useSession.getState().focusLayout).toEqual({ railOpen: false, rightOpen: true, sideView: "stage", browserView: null, browserW: null, railW: null, sideW: null });
  });

  it("字段类型不合法 → 逐字段回退默认", async () => {
    localStorage.setItem(FOCUS_LAYOUT_KEY, JSON.stringify({ railOpen: "yes", rightOpen: false }));
    const useSession = await freshStore();
    expect(useSession.getState().focusLayout).toEqual({ railOpen: false, rightOpen: false, sideView: "stage", browserView: null, browserW: null, railW: null, sideW: null });
  });

  it("setFocusLayout 打补丁并持久化", async () => {
    const useSession = await freshStore();
    useSession.getState().setFocusLayout({ railOpen: true });
    expect(useSession.getState().focusLayout).toEqual({ railOpen: true, rightOpen: true, sideView: "stage", browserView: null, browserW: null, railW: null, sideW: null });
    expect(JSON.parse(localStorage.getItem(FOCUS_LAYOUT_KEY) ?? "{}")).toEqual({
      railOpen: true,
      rightOpen: true,
      sideView: "stage",
      browserView: null,
      browserW: null,
      railW: null,
      sideW: null,
    });
  });
});
