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
