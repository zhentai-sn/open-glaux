// 主题（SDD feats/12）——深色 / 浅色两档；缺省深色（纲领 G11：影像审读的暗环境基底）。
// 取值写 <html data-theme>，颜色全部由 tokens.css 按该属性切换；组件不读主题做分支，
// 例外只有 dockview 需要换主题对象（Shell.tsx）。
import { create } from "zustand";

export type Theme = "dark" | "light";

export const THEME_KEY = "glaux.theme.v1";

// 缺省/非法/localStorage 不可用 → dark，不抛错。
function loadTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function applyTheme(theme: Theme) {
  if (typeof document !== "undefined") document.documentElement.dataset.theme = theme;
}

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  theme: loadTheme(),
  setTheme: (theme) => {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* localStorage 不可用（隐私模式等）时只切当前页 */
    }
    applyTheme(theme);
    set({ theme });
  },
  toggleTheme: () => get().setTheme(get().theme === "dark" ? "light" : "dark"),
}));

// 模块加载即落属性（main.tsx 在首帧渲染前 import），避免先按深色画一帧。
applyTheme(useTheme.getState().theme);
