// 对话阅读面偏好（2026-10-24 阅读体验）：字号档、跟随滚动、流式渐现。
// 字号写 <html data-reading>，tokens.css 按属性给 --read-*；组件只读 token，不读档位。
// 跟随与渐现由组件按开关分支；这里只负责持久化与跨组件共享。
import { create } from "zustand";

export type ReadingSize = "compact" | "standard" | "comfortable";

export const READING_KEY = "glaux.reading.v1";

const SIZES: ReadingSize[] = ["compact", "standard", "comfortable"];

export interface ReadingPrefs {
  size: ReadingSize;
  follow: boolean;
  reveal: boolean;
}

const DEFAULTS: ReadingPrefs = { size: "standard", follow: true, reveal: true };

function isSize(value: unknown): value is ReadingSize {
  return typeof value === "string" && (SIZES as string[]).includes(value);
}

/** 读 localStorage；非法 JSON、缺字段、非法档位一律回落默认，不抛错。 */
export function loadReading(): ReadingPrefs {
  try {
    const raw = localStorage.getItem(READING_KEY);
    if (!raw) return DEFAULTS;
    const value = JSON.parse(raw) as Partial<ReadingPrefs> | null;
    if (!value || typeof value !== "object") return DEFAULTS;
    return {
      size: isSize(value.size) ? value.size : DEFAULTS.size,
      follow: typeof value.follow === "boolean" ? value.follow : DEFAULTS.follow,
      reveal: typeof value.reveal === "boolean" ? value.reveal : DEFAULTS.reveal,
    };
  } catch {
    return DEFAULTS;
  }
}

function applyReading(prefs: ReadingPrefs): void {
  if (typeof document !== "undefined") document.documentElement.dataset.reading = prefs.size;
}

function saveReading(prefs: ReadingPrefs): void {
  try {
    localStorage.setItem(READING_KEY, JSON.stringify(prefs));
  } catch {
    /* localStorage 不可用（隐私模式等）时只作用于当前页 */
  }
}

interface ReadingState extends ReadingPrefs {
  setSize: (size: ReadingSize) => void;
  setFollow: (follow: boolean) => void;
  setReveal: (reveal: boolean) => void;
}

export const useReading = create<ReadingState>((set, get) => {
  const update = (patch: Partial<ReadingPrefs>) => {
    const current = get();
    const prefs: ReadingPrefs = {
      size: patch.size ?? current.size,
      follow: patch.follow ?? current.follow,
      reveal: patch.reveal ?? current.reveal,
    };
    applyReading(prefs);
    saveReading(prefs);
    set(patch);
  };
  return {
    ...loadReading(),
    setSize: (size) => {
      if (isSize(size)) update({ size });
    },
    setFollow: (follow) => update({ follow }),
    setReveal: (reveal) => update({ reveal }),
  };
});

// 模块加载即落属性（main.tsx 在首帧渲染前 import），避免先按标准档画一帧再跳档。
applyReading(useReading.getState());
