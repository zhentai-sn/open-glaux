import { create } from "zustand";

import type { I18nKey } from "../i18n";
import type { HCEllipse, ImageMeta, IntentBackendInfo, Modality, ModelInfo, Scope } from "../api/types";

export type IntentBackendId = "rule" | "vlm";

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

// 胎儿头围（HC，闭合轮廓模态）：检测到的颅骨轮廓 + 拟合椭圆 + 来源。
export interface HCContour {
  points: number[][];
  ellipse: HCEllipse;
  source: "agent" | "human";
  modelVersion: string;
}

export interface HCMeasure {
  hc_mm: number;
  bpd_mm: number;
  ofd_mm: number;
  area_mm2: number;
  vs_gt_mm: number | null;
}

export type View = "explorer" | "search" | "scm" | "models";
export type PanelTab = "meas" | "out" | "prob";
export type Tool = "cursor" | "editli" | "editma" | "roi" | "reset";

// 智能体消息以 i18n 键 + 变量存储（非解析后的字符串），切语言即重译、历史不丢（设计稿 §4/R8）。
export type Msg =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "agent"; variant: "plain" | "refuse" | "clarify"; key: I18nKey; vars?: Record<string, string> }
  | { id: number; role: "agent"; variant: "note"; text: string; tone: "crit" | "plain" }
  | {
      id: number;
      role: "agent";
      variant: "run";
      model: string;
      imt: string;
      max: string;
      cols: number;
      vsA1: number | null;
    }
  | {
      id: number;
      role: "agent";
      variant: "hcrun";
      model: string;
      hc: string;
      bpd: string;
      ofd: string;
      vsGt: number | null;
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
  modality: Modality; // 当前模态（颈动脉 IMT / 胎儿 HC）
  activeImage: string | null;
  activeModel: string;
  models: ModelInfo[];
  images: ImageMeta[]; // 数据集列表（Explorer）
  imageMeta: ImageMeta | null; // 当前图元数据（cf/methods）
  boundaries: Boundaries | null; // 当前叠加边界（IMT）
  measurement: Measurement | null; // 当前测量（IMT）
  hcContour: HCContour | null; // 当前颅骨轮廓 + 椭圆（HC）
  hcMeasurement: HCMeasure | null; // 当前 HC 测量
  imt: string; // 当前展示的 IMT（mm，字符串保三位）
  lastScope: Scope | null;
  loading: boolean; // 分割/测量进行中
  coords: { x: number; y: number }; // 画布光标坐标（状态栏读出）

  // 意图后端（VLM 配置）
  intentBackend: IntentBackendId;
  intentBackends: IntentBackendInfo[]; // 服务端可用性
  vlmKey: string; // UI 填入的密钥（localStorage）
  vlmModel: string; // 可选模型覆盖

  // 智能体对话
  messages: Msg[];

  // actions
  setSidebarView: (v: View) => void;
  setPanelTab: (t: PanelTab) => void;
  togglePanel: () => void;
  setTool: (t: Tool) => void;
  setModality: (m: Modality) => void;
  setActiveImage: (id: string | null) => void;
  setModels: (m: ModelInfo[]) => void;
  activateModel: (id: string) => void;
  setImages: (m: ImageMeta[]) => void;
  setImageMeta: (m: ImageMeta | null) => void;
  setBoundaries: (b: Boundaries | null) => void;
  setMeasurement: (m: Measurement | null) => void;
  setHcContour: (c: HCContour | null) => void;
  setHcMeasurement: (m: HCMeasure | null) => void;
  setImt: (v: string) => void;
  setLastScope: (s: Scope | null) => void;
  setLoading: (v: boolean) => void;
  setCoords: (x: number, y: number) => void;
  setIntentBackend: (id: IntentBackendId) => void;
  setIntentBackends: (b: IntentBackendInfo[]) => void;
  setVlmKey: (k: string) => void;
  setVlmModel: (m: string) => void;
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

  modality: "carotid_imt",
  activeImage: null,
  activeModel: "caroSegDeep",
  models: [],
  images: [],
  imageMeta: null,
  boundaries: null,
  measurement: null,
  hcContour: null,
  hcMeasurement: null,
  imt: "—",
  lastScope: null,
  loading: false,
  coords: { x: 0, y: 0 },

  intentBackend: "rule",
  intentBackends: [],
  vlmKey: (typeof localStorage !== "undefined" && localStorage.getItem("glaux.vlmKey")) || "",
  vlmModel: (typeof localStorage !== "undefined" && localStorage.getItem("glaux.vlmModel")) || "",

  messages: [],

  setSidebarView: (v) => set({ sidebarView: v }),
  setPanelTab: (t) => set({ panelTab: t }),
  togglePanel: () => set((s) => ({ panelCollapsed: !s.panelCollapsed })),
  setTool: (t) => set({ tool: t }),
  setModality: (m) => set({ modality: m }),
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
  setHcContour: (c) => set({ hcContour: c }),
  setHcMeasurement: (m) => set({ hcMeasurement: m, imt: m ? m.hc_mm.toFixed(1) : "—" }),
  setImt: (v) => set({ imt: v }),
  setLastScope: (s) => set({ lastScope: s }),
  setLoading: (v) => set({ loading: v }),
  setCoords: (x, y) => set({ coords: { x, y } }),
  setIntentBackend: (id) => set({ intentBackend: id }),
  setIntentBackends: (b) => set({ intentBackends: b }),
  setVlmKey: (k) => {
    try {
      localStorage.setItem("glaux.vlmKey", k);
    } catch {
      /* noop */
    }
    set({ vlmKey: k });
  },
  setVlmModel: (m) => {
    try {
      localStorage.setItem("glaux.vlmModel", m);
    } catch {
      /* noop */
    }
    set({ vlmModel: m });
  },
  pushUser: (text) => set((s) => ({ messages: [...s.messages, { id: nextId(), role: "user", text }] })),
  pushAgent: (m) =>
    set((s) => ({ messages: [...s.messages, { ...m, role: "agent", id: nextId() } as AgentMsg] })),
  resetMessages: () => set({ messages: [] }),
}));
