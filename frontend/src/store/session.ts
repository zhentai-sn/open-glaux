import { create } from "zustand";

import type { I18nKey } from "../i18n";
import type {
  Capability,
  DataSource,
  ImageMeta,
  IntentBackendInfo,
  Measure,
  Modality,
  ModelInfo,
  Primitive,
  Scope,
  TaskType,
  TaskView,
} from "../api/types";

export type IntentBackendId = "rule" | "vlm";

export type Source = "agent" | "human"; // 当前叠加/测量的来源（模型产出 vs 人工修正）

export type View = "explorer" | "market"; // 侧边栏视图：资源管理器 / 插件市场（去掉搜索/源代码管理）
export type PanelTab = "meas" | "out" | "prob" | "term";
export type Tool = "cursor" | "editli" | "editma" | "roi" | "reset";

// 智能体消息以 i18n 键 + 变量存储（非解析后的字符串），切语言即重译、历史不丢（设计稿 §4/R8）。
export type Msg =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "agent"; variant: "plain" | "refuse" | "clarify"; key: I18nKey; vars?: Record<string, string> }
  | { id: number; role: "agent"; variant: "note"; text: string; tone: "crit" | "plain" }
  | {
      // 泛型任务运行卡片（多模态·替代逐模态 run/hcrun）——携任务 + 模型 + 度量快照，
      // 卡片按注册表（label/metrics/overlays）渲染，加任务零改。
      id: number;
      role: "agent";
      variant: "taskrun";
      task: TaskType;
      model: string;
      metrics: Record<string, Measure>;
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
  tasks: TaskView[]; // 任务注册表（GET /tasks）——切换器/工具/度量的真相源
  modality: Modality; // 当前模态（颈动脉 IMT / 胎儿 HC / CT 腹部）
  activeImage: string | null; // 2D 模态的当前图（CUBS / HC18 id）
  activeVolume: string | null; // P6：3D 模态的当前 CT volume id
  activeSlide: string | null; // P7：病理 WSI 的当前 slide id
  wsiRoi: [number, number, number, number] | null; // P7：当前框选 ROI (x0,y0,x1,y1) level-0 px
  activeModel: string;
  models: ModelInfo[];
  capabilities: Capability[]; // 能力注册表（GET /capabilities）——「插件市场」真相源
  datasources: DataSource[]; // 数据源注册表（GET /datasources）——dev-mode 标识 + 导入源管理
  images: ImageMeta[]; // 数据集列表（Explorer）
  volumes: ImageMeta[]; // P6：CT 体积列表
  slides: ImageMeta[]; // P7：WSI slide 列表
  imageMeta: ImageMeta | null; // 当前图元数据（cf/methods 或 voxel_spacing_mm）
  metrics: Record<string, Measure> | null; // 泛型度量（多模态·TaskOutput.metrics）——面板/状态栏/卡片真相源
  primitives: Primitive[]; // 泛型几何原语（多模态·TaskOutput.primitives）——查看器渲染真相源
  source: Source; // 当前叠加来源（agent 模型产出 / human 人工修正）
  modelVersion: string; // 当前结果的模型版本（供卡片/输出栏展示）
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
  setTasks: (t: TaskView[]) => void;
  setModality: (m: Modality) => void;
  setActiveImage: (id: string | null) => void;
  setActiveVolume: (id: string | null) => void; // P6
  setActiveSlide: (id: string | null) => void; // P7
  setWsiRoi: (roi: [number, number, number, number] | null) => void; // P7
  setModels: (m: ModelInfo[]) => void;
  setCapabilities: (c: Capability[]) => void;
  setDatasources: (d: DataSource[]) => void;
  activateModel: (id: string) => void;
  setImages: (m: ImageMeta[]) => void;
  setVolumes: (m: ImageMeta[]) => void; // P6
  setSlides: (m: ImageMeta[]) => void; // P7
  setImageMeta: (m: ImageMeta | null) => void;
  setMetrics: (m: Record<string, Measure> | null) => void;
  setPrimitives: (p: Primitive[]) => void;
  setSource: (s: Source) => void;
  setModelVersion: (v: string) => void;
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

  tasks: [],
  modality: "carotid_imt",
  activeImage: null,
  activeVolume: null,
  activeSlide: null,
  wsiRoi: null,
  activeModel: "caroSegDeep",
  models: [],
  capabilities: [],
  datasources: [],
  images: [],
  volumes: [],
  slides: [],
  imageMeta: null,
  metrics: null,
  primitives: [],
  source: "agent",
  modelVersion: "",
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
  setTasks: (t) => set({ tasks: t }),
  setModality: (m) => set({ modality: m }),
  setActiveImage: (id) => set({ activeImage: id }),
  setActiveVolume: (id) => set({ activeVolume: id }),
  setActiveSlide: (id) => set({ activeSlide: id }),
  setWsiRoi: (roi) => set({ wsiRoi: roi }),
  setModels: (m) => set({ models: m, activeModel: m.find((x) => x.active)?.id ?? "caroSegDeep" }),
  setCapabilities: (c) => set({ capabilities: c }),
  setDatasources: (d) => set({ datasources: d }),
  activateModel: (id) =>
    set((s) => ({
      activeModel: id,
      models: s.models.map((m) => ({ ...m, active: m.id === id })),
    })),
  setImages: (m) => set({ images: m }),
  setVolumes: (m) => set({ volumes: m }),
  setSlides: (m) => set({ slides: m }),
  setImageMeta: (m) => set({ imageMeta: m }),
  setMetrics: (m) => set({ metrics: m }),
  setPrimitives: (p) => set({ primitives: p }),
  setSource: (v) => set({ source: v }),
  setModelVersion: (v) => set({ modelVersion: v }),
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
