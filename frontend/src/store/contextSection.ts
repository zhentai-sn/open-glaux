import { create } from "zustand";

/**
 * 上下文页的当前分区（SDD 19 §7.2 规则 3、§9.4；轨迹见 SDD 21 §9.5）——per-viewer 便利项，Focus 与 Workbench 共用。
 * 记忆、MCP 暂未开放，不是合法取值。
 */
export type ContextSection = "system" | "templates" | "tools" | "agents" | "skills" | "trajectory";
export const CONTEXT_SECTIONS: readonly ContextSection[] = ["system", "templates", "tools", "agents", "skills", "trajectory"];
const KEY = "glaux.contextSection.v1";

function load(): ContextSection {
  try {
    const raw = localStorage.getItem(KEY);
    if (CONTEXT_SECTIONS.includes(raw as ContextSection)) return raw as ContextSection;
  } catch {
    /* 存储不可用 → 缺省 */
  }
  return "system";
}

interface ContextSectionState {
  section: ContextSection;
  setSection: (section: ContextSection) => void;
}

export const useContextSection = create<ContextSectionState>((set) => ({
  section: load(),
  setSection: (section) => {
    try {
      localStorage.setItem(KEY, section);
    } catch {
      /* 持久化失败不阻塞切换 */
    }
    set({ section });
  },
}));
