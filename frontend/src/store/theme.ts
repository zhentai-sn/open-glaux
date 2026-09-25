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

// 强调色（SDD feats/12 §7.2）——覆盖智能体紫一族 token；null 表示跟随主题默认紫。
// 只写 <html> 行内变量 --accent-user / --accent-on / --accent-status，tokens.css 以它们为首选。
export const ACCENT_KEY = "glaux.accent.v1";
export const DEFAULT_ACCENT: Record<Theme, string> = { dark: "#b58bf2", light: "#7c4dd6" };
const HEX6 = /^#[0-9a-f]{6}$/i;

function loadAccent(): string | null {
  try {
    const v = localStorage.getItem(ACCENT_KEY);
    return v && HEX6.test(v) ? v.toLowerCase() : null;
  } catch {
    return null;
  }
}

function rgbOf(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// WCAG 相对亮度。
function luminance(hex: string): number {
  const [r, g, b] = rgbOf(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const ON_DARK = "#141414";
const ON_LIGHT = "#ffffff";

/** 强调色底上的文字色：白字与深字中对比度更高者。 */
export function onAccent(hex: string): string {
  const l = luminance(hex);
  return (l + 0.05) / (luminance(ON_DARK) + 0.05) >= 1.05 / (l + 0.05) ? ON_DARK : ON_LIGHT;
}

/** 状态栏底色：强调色压暗 40%，保证其上白字可读。 */
export function statusShade(hex: string): string {
  return "#" + rgbOf(hex).map((c) => Math.round(c * 0.6).toString(16).padStart(2, "0")).join("");
}

function applyAccent(accent: string | null) {
  if (typeof document === "undefined") return;
  const s = document.documentElement.style;
  if (!accent) {
    s.removeProperty("--accent-user");
    s.removeProperty("--accent-on");
    s.removeProperty("--accent-status");
    return;
  }
  s.setProperty("--accent-user", accent);
  s.setProperty("--accent-on", onAccent(accent));
  s.setProperty("--accent-status", statusShade(accent));
}

interface ThemeState {
  theme: Theme;
  accent: string | null;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  /** 传 null 恢复主题默认紫；非法值忽略。 */
  setAccent: (accent: string | null) => void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  theme: loadTheme(),
  accent: loadAccent(),
  setAccent: (accent) => {
    if (accent !== null && !HEX6.test(accent)) return;
    const next = accent?.toLowerCase() ?? null;
    try {
      if (next) localStorage.setItem(ACCENT_KEY, next);
      else localStorage.removeItem(ACCENT_KEY);
    } catch {
      /* localStorage 不可用时只作用于当前页 */
    }
    applyAccent(next);
    set({ accent: next });
  },
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
applyAccent(useTheme.getState().accent);
