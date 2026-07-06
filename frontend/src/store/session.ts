import { create } from "zustand";

import type { I18nKey } from "../i18n";
import type { ModelInfo, Scope } from "../api/types";

export type View = "explorer" | "search" | "scm" | "models";
export type PanelTab = "meas" | "out" | "prob";
export type Tool = "cursor" | "editli" | "editma" | "roi" | "reset";

// 智能体消息以 i18n 键 + 变量存储（非解析后的字符串），切语言即重译、历史不丢（设计稿 §4/R8）。
export type Msg =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "agent"; variant: "plain" | "refuse" | "clarify"; key: I18nKey; vars?: Record<string, string> }
  | { id: number; role: "agent"; variant: "run"; model: string; imt: string };

// 联合上的 Omit 需分布，否则各成员的判别字段会坍塌（TS 会误判字面量缺属性）。
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
type AgentMsg = Extract<Msg, { role: "agent" }>;

interface SessionState {
  // 侧边栏 / 面板 / 工具
  sidebarView: View;
  panelTab: PanelTab;
  panelCollapsed: boolean;
  tool: Tool;

  // 领域
  activeImage: string | null;
  activeModel: string;
  models: ModelInfo[];
  imt: string; // 当前展示的 IMT（mm，字符串保三位）
  lastScope: Scope | null;
  coords: { x: number; y: number }; // 画布光标坐标（状态栏读出）

  // 智能体对话
  messages: Msg[];

  // actions
  setSidebarView: (v: View) => void;
  setPanelTab: (t: PanelTab) => void;
  togglePanel: () => void;
  setTool: (t: Tool) => void;
  setActiveImage: (id: string | null) => void;
  setModels: (m: ModelInfo[]) => void;
  activateModel: (id: string) => void;
  setImt: (v: string) => void;
  setLastScope: (s: Scope | null) => void;
  setCoords: (x: number, y: number) => void;
  pushUser: (text: string) => void;
  pushAgent: (m: DistributiveOmit<AgentMsg, "id" | "role">) => void;
  resetMessages: () => void;
}

let _id = 0;
const nextId = () => ++_id;

export const useSession = create<SessionState>((set) => ({
  sidebarView: "explorer",
  panelTab: "meas",
  panelCollapsed: false,
  tool: "cursor",

  activeImage: "tech_437",
  activeModel: "caroSegDeep",
  models: [],
  imt: "0.918",
  lastScope: null,
  coords: { x: 412, y: 291 },

  messages: [],

  setSidebarView: (v) => set({ sidebarView: v }),
  setPanelTab: (t) => set({ panelTab: t }),
  togglePanel: () => set((s) => ({ panelCollapsed: !s.panelCollapsed })),
  setTool: (t) => set({ tool: t }),
  setActiveImage: (id) => set({ activeImage: id }),
  setModels: (m) => set({ models: m, activeModel: m.find((x) => x.active)?.id ?? "caroSegDeep" }),
  activateModel: (id) =>
    set((s) => ({
      activeModel: id,
      models: s.models.map((m) => ({ ...m, active: m.id === id })),
    })),
  setImt: (v) => set({ imt: v }),
  setLastScope: (s) => set({ lastScope: s }),
  setCoords: (x, y) => set({ coords: { x, y } }),
  pushUser: (text) => set((s) => ({ messages: [...s.messages, { id: nextId(), role: "user", text }] })),
  pushAgent: (m) =>
    set((s) => ({ messages: [...s.messages, { ...m, role: "agent", id: nextId() } as AgentMsg] })),
  resetMessages: () => set({ messages: [] }),
}));
