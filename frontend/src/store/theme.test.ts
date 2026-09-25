// 主题 store 契约（SDD feats/12 §15）：缺省/合法/非法回退、切换即持久化并落 <html data-theme>。
// store 为模块级单例（loadTheme 在 import 时执行），故用 resetModules + 动态 import 取新实例。
import { beforeEach, describe, expect, it, vi } from "vitest";

const THEME_KEY = "glaux.theme.v1";

async function freshStore() {
  vi.resetModules();
  const mod = await import("./theme");
  return mod.useTheme;
}

describe("theme（SDD feats/12）", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it("无持久化键 → dark，且 import 即落 data-theme", async () => {
    const useTheme = await freshStore();
    expect(useTheme.getState().theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("合法值 light → 恢复 light", async () => {
    localStorage.setItem(THEME_KEY, "light");
    const useTheme = await freshStore();
    expect(useTheme.getState().theme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("非法值 → 回退 dark", async () => {
    localStorage.setItem(THEME_KEY, "sepia");
    const useTheme = await freshStore();
    expect(useTheme.getState().theme).toBe("dark");
  });

  it("toggleTheme 往返：写 localStorage 与 data-theme", async () => {
    const useTheme = await freshStore();
    useTheme.getState().toggleTheme();
    expect(useTheme.getState().theme).toBe("light");
    expect(localStorage.getItem(THEME_KEY)).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    useTheme.getState().toggleTheme();
    expect(useTheme.getState().theme).toBe("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});

describe("accent（SDD feats/12 §7.2）", () => {
  const ACCENT_KEY = "glaux.accent.v1";
  const root = () => document.documentElement.style;

  beforeEach(() => {
    localStorage.clear();
    root().removeProperty("--accent-user");
    root().removeProperty("--accent-on");
    root().removeProperty("--accent-status");
  });

  it("无持久化键 → null，不写行内变量", async () => {
    const useTheme = await freshStore();
    expect(useTheme.getState().accent).toBeNull();
    expect(root().getPropertyValue("--accent-user")).toBe("");
  });

  it("合法 hex 恢复并落行内变量；非法值回退 null", async () => {
    localStorage.setItem(ACCENT_KEY, "#3B82F6");
    let useTheme = await freshStore();
    expect(useTheme.getState().accent).toBe("#3b82f6");
    expect(root().getPropertyValue("--accent-user")).toBe("#3b82f6");

    localStorage.setItem(ACCENT_KEY, "purple");
    root().removeProperty("--accent-user");
    useTheme = await freshStore();
    expect(useTheme.getState().accent).toBeNull();
    expect(root().getPropertyValue("--accent-user")).toBe("");
  });

  it("setAccent 持久化并按对比度选文字色；null 清除；非法值忽略", async () => {
    const useTheme = await freshStore();
    useTheme.getState().setAccent("#FDE047"); // 亮黄 → 深字
    expect(localStorage.getItem(ACCENT_KEY)).toBe("#fde047");
    expect(root().getPropertyValue("--accent-on")).toBe("#141414");
    expect(root().getPropertyValue("--accent-status")).toBe("#98862b");

    useTheme.getState().setAccent("#1e3a8a"); // 深蓝 → 白字
    expect(root().getPropertyValue("--accent-on")).toBe("#ffffff");

    useTheme.getState().setAccent("red");
    expect(useTheme.getState().accent).toBe("#1e3a8a");

    useTheme.getState().setAccent(null);
    expect(useTheme.getState().accent).toBeNull();
    expect(localStorage.getItem(ACCENT_KEY)).toBeNull();
    expect(root().getPropertyValue("--accent-user")).toBe("");
  });
});
