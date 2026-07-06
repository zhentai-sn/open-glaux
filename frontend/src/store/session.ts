import { create } from "zustand";

import type { I18nKey } from "../i18n";
import type { ImageMeta, ModelInfo, Scope } from "../api/types";

// 画布叠加的边界（图像像素坐标）+ 来源（agent/human）+ 产出模型版本。
export interface Boundaries {
  li: number[][];
  ma: number[][];
  source: "agent" | "human";
  modelVersion: string;
}

export interface Measurement {
  mean_mm: number;
  max_mm: number;
  pdm_mean_mm: number;
  n_columns: number;
  vs_a1_um: number | null;
}

export type View = "explorer" | "search" | "scm" | "models";
export type PanelTab = "meas" | "out" | "prob";
export type Tool = "cursor" | "editli" | "editma" | "roi" | "reset";

// 智能体消息以 i18n 键 + 变量存储（非解析后的字符串），切语言即重译、历史不丢（设计稿 §4/R8）。
export type Msg =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "agent"; variant: "plain" | "refuse" | "clarify"; key: I18nKey; vars?: Record<string, string> }
  | {
      id: number;
      role: "agent";
      variant: "run";
      model: string;
      imt: string;
      max: string;
      cols: number;
      vsA1: number | null;
    };

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
  images: ImageMeta[]; // 数据集列表（Explorer）
  imageMeta: ImageMeta | null; // 当前图元数据（cf/methods）
  boundaries: Boundaries | null; // 当前叠加边界
  measurement: Measurement | null; // 当前测量
  imt: string; // 当前展示的 IMT（mm，字符串保三位）
  lastScope: Scope | null;
  loading: boolean; // 分割/测量进行中
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
  setImages: (m: ImageMeta[]) => void;
  setImageMeta: (m: ImageMeta | null) => void;
  setBoundaries: (b: Boundaries | null) => void;
  setMeasurement: (m: Measurement | null) => void;
  setImt: (v: string) => void;
  setLastScope: (s: Scope | null) => void;
  setLoading: (v: boolean) => void;
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

  activeImage: null,
  activeModel: "caroSegDeep",
  models: [],
  images: [],
  imageMeta: null,
  boundaries: null,
  measurement: null,
  imt: "—",
  lastScope: null,
  loading: false,
  coords: { x: 0, y: 0 },

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
  setImages: (m) => set({ images: m }),
  setImageMeta: (m) => set({ imageMeta: m }),
  setBoundaries: (b) => set({ boundaries: b }),
  setMeasurement: (m) =>
    set({ measurement: m, imt: m ? m.pdm_mean_mm.toFixed(3) : "—" }),
  setImt: (v) => set({ imt: v }),
  setLastScope: (s) => set({ lastScope: s }),
  setLoading: (v) => set({ loading: v }),
  setCoords: (x, y) => set({ coords: { x, y } }),
  pushUser: (text) => set((s) => ({ messages: [...s.messages, { id: nextId(), role: "user", text }] })),
  pushAgent: (m) =>
    set((s) => ({ messages: [...s.messages, { ...m, role: "agent", id: nextId() } as AgentMsg] })),
  resetMessages: () => set({ messages: [] }),
}));
