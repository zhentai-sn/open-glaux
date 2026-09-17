import { CHAT_EDITION } from "../edition";
import { create } from "zustand";

import type {
  Annotation,
  Capability,
  DataSource,
  ImageMeta,
  Measure,
  Modality,
  ModelInfo,
  Primitive,
  TaskView,
  VlmModelInfo,
  VlmProvider,
} from "../api/types";
import type { Attachment } from "../agent/attachments";
import { readRecent, writeRecent, type RecentItem } from "../data/recent";

/** 一条 VLM 连接（SDD 2026-07-14-001 §4）——provider + 端点 + 密钥 + 选定模型。 */
export interface Connection {
  provider: VlmProvider;
  baseUrl: string; // "" → 用 provider 默认
  apiKey: string; // 仅本机 localStorage；发请求随 body 传后端
  model: string; // 选定模型 id
  contextWindow: number | null; // 自定义模型必填；缺省用探测值/默认值预填（SDD 00 §4）
  maxTokens: number | null; // 同上；Pi 内置目录已知模型可为空
  models?: VlmModelInfo[]; // 上次拉取缓存（UI 便利，可失效）
  lastTest?: { ok: boolean; at: string; reason?: string };
}

/** 探不到上游元数据时的兜底（2026-08-19 决议，SDD 00 §4）——预填而非静默代入，用户可改。 */
export const DEFAULT_CONTEXT_WINDOW = 128_000;
export const DEFAULT_MAX_TOKENS = 8_192;

const CONNECTION_DEFAULTS: Connection = {
  provider: "anthropic",
  baseUrl: "",
  apiKey: "",
  model: "",
  contextWindow: DEFAULT_CONTEXT_WINDOW,
  maxTokens: DEFAULT_MAX_TOKENS,
};

/** 载入连接：优先新键 glaux.connection；否则一次性从旧 vlmKey/vlmModel 迁移（旧键保留可回滚）。 */
function loadConnection(): Connection {
  if (typeof localStorage === "undefined") return { ...CONNECTION_DEFAULTS };
  const raw = localStorage.getItem("glaux.connection");
  if (raw) {
    try {
      const stored = JSON.parse(raw) as Partial<Connection>;
      const merged: Connection = { ...CONNECTION_DEFAULTS, ...stored };
      // 老版本存过 null（当时必填、初始为空）——载入时补回默认值，免得用户又被逼着填。
      if (merged.contextWindow === null) merged.contextWindow = DEFAULT_CONTEXT_WINDOW;
      if (merged.maxTokens === null) merged.maxTokens = DEFAULT_MAX_TOKENS;
      return merged;
    } catch {
      /* 损坏 → 落回默认 + 迁移 */
    }
  }
  const apiKey = localStorage.getItem("glaux.vlmKey") || "";
  const model = localStorage.getItem("glaux.vlmModel") || "";
  const migrated: Connection = { ...CONNECTION_DEFAULTS, apiKey, model };
  if (apiKey || model) {
    try {
      localStorage.setItem("glaux.connection", JSON.stringify(migrated));
    } catch {
      /* noop */
    }
  }
  return migrated;
}

export type Source = "agent" | "human"; // 当前叠加/测量的来源（模型产出 vs 人工修正）

// ---- 双模式外壳（SDD feats/01）----
export type UiMode = "focus" | "workbench";
const UIMODE_KEY = "glaux.uiMode.v1"; // 字面量存储；改语义时 bump 版本，旧键作废回默认
const FOCUS_LAYOUT_KEY = "glaux.focusLayout.v1"; // JSON；损坏回默认

/**
 * Focus 右侧栏的浏览器列（SDD feats/01 v1.4 §9 / D16、D18）：文件 / 图谱，二者互斥。
 * `null` = 浏览器列关闭，侧栏纯舞台——舞台自 v1.4 起常驻，不再是三标签之一，故枚举里没有 "stage"。
 */
export type FocusBrowserView = "files" | "atlas";
const BROWSER_VIEWS: readonly FocusBrowserView[] = ["files", "atlas"];

/** Focus 栏宽的允许范围（SDD feats/01 v1.3 §9/D15）——对话列由 CONVERSATION_MIN_W 保底，右侧图像栏允许占据更大空间。 */
export const RAIL_W = { min: 200, max: 420, def: 236 } as const;
export const SIDE_W = { min: 280, max: 1200 } as const;
/** 右侧栏内浏览器列的允许宽度（SDD feats/01 v1.4 §9）。缺省即最窄：默认把像素让给舞台（D19）。 */
export const BROWSER_W = { min: 240, max: 480, def: 240 } as const;
/** 分栏时舞台的最低宽度：浏览器列的拖拽上界由「实测侧栏宽 − 此值」反向夹住。 */
export const STAGE_MIN = 360;
/**
 * 侧栏分栏阈值（SDD feats/01 v1.4 §9）——低于 `enter` 退回整栏互斥，高于 `exit` 才恢复分栏。
 * 24px 迟滞：否则拖到临界宽度时会在两种形态间反复重排。
 */
export const SIDE_SPLIT = { enter: 640, exit: 664 } as const;
/** 对话列的最低可用宽度：拖拽时两侧栏被此值反向夹住（窄窗口的上界另由 CSS max-width 兜底）。 */
export const CONVERSATION_MIN_W = 360;

/**
 * Focus 布局微状态（会话栏开合与宽度 / 右侧栏开合、标签与宽度）——UI 微状态，非领域字段。
 * `railW`/`sideW` 为 null = 用户没拖过，沿用默认（会话栏 236px；右侧栏按 flex 比例自适应）。
 */
export interface FocusLayout {
  railOpen: boolean;
  rightOpen: boolean;
  browserView: FocusBrowserView | null;
  browserW: number | null;
  railW: number | null;
  sideW: number | null;
}
export const FOCUS_LAYOUT_DEFAULTS: FocusLayout = {
  railOpen: false,
  rightOpen: true,
  browserView: null,
  browserW: null,
  railW: null,
  sideW: null,
};

/** 载入期的栏宽校验：非有限数/非正数 → null（回默认）；越界 → 夹回范围，不白屏也不留下畸形布局。 */
function loadWidth(v: unknown, range: { min: number; max: number }): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  return Math.min(range.max, Math.max(range.min, Math.round(v)));
}

/** 读 uiMode：仅接受两个字面量，缺失/损坏一律回退 focus（默认值即产品立场，SDD §6.3/D2）。 */
function loadUiMode(): UiMode {
  if (CHAT_EDITION) return "focus";
  try {
    const raw = localStorage.getItem(UIMODE_KEY);
    if (raw === "focus" || raw === "workbench") return raw;
  } catch {
    /* localStorage 不可用 → 默认 */
  }
  return "focus";
}

function loadFocusLayout(): FocusLayout {
  try {
    const raw = localStorage.getItem(FOCUS_LAYOUT_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        // v1.0 存的是 stageOpen（舞台开合）；v1.1 起为右侧栏 rightOpen——旧值迁移，字段级校验
        const p = parsed as Partial<FocusLayout> & { stageOpen?: unknown; rightView?: unknown };
        const rightOpen =
          typeof p.rightOpen === "boolean"
            ? p.rightOpen
            : typeof p.stageOpen === "boolean"
              ? p.stageOpen
              : FOCUS_LAYOUT_DEFAULTS.rightOpen;
        // v1.1–v1.3 存的是三值 rightView；v1.4 起舞台常驻，"stage" 即「没有浏览器列」→ null。
        // 非法值同样落 null（纯舞台是最保守的形态：不会把用户丢进一个空浏览器）。
        const legacy = BROWSER_VIEWS.includes(p.rightView as FocusBrowserView)
          ? (p.rightView as FocusBrowserView)
          : null;
        return {
          railOpen: typeof p.railOpen === "boolean" ? p.railOpen : FOCUS_LAYOUT_DEFAULTS.railOpen,
          rightOpen,
          browserView: BROWSER_VIEWS.includes(p.browserView as FocusBrowserView)
            ? (p.browserView as FocusBrowserView)
            : legacy,
          browserW: loadWidth(p.browserW, BROWSER_W),
          railW: loadWidth(p.railW, RAIL_W),
          sideW: loadWidth(p.sideW, SIDE_W),
        };
      }
    }
  } catch {
    /* 损坏 → 默认 */
  }
  return { ...FOCUS_LAYOUT_DEFAULTS };
}

export type View = "explorer" | "market" | "atlas"; // 侧边栏视图：资源管理器 / 插件市场 / 图谱（SDD feats/03）
export type PanelTab = "meas" | "out" | "prob" | "term";
/**
 * SDD 04：统一工具集合——替代旧的 editli/editma/roi（roi 更名 bbox）。
 * `wall` 是任务专属编辑（IMT 壁线形变），单独占一个工具位：曾经把它挂在 polygon 上，
 * 结果 IMT 模态的「多边形标注」既画不出多边形、无壁线时还静默无响应。
 */
export type Tool = "cursor" | "bbox" | "polygon" | "wall" | "brush" | "reset";

/** SDD 04：工具参数（随 switchModality 复位）——从查看器本地 state 提升为全局真相源。 */
export interface ToolOptions {
  brush: { mode: "paint" | "erase"; classId: number; radius: number };
  voi: { ww: number; wl: number };
}

export const TOOL_OPTIONS_DEFAULTS: ToolOptions = {
  brush: { mode: "erase", classId: 1, radius: 3 },
  voi: { ww: 400, wl: 40 }, // CT 腹部软组织窗（与 nifti loader 默认一致）
};

/**
 * 查看器侧的一条即时提示（错误 / 提示）——单槽，最新覆盖最旧，由 <Notice/> 在两种外壳里渲染。
 * 取代已退役的旧聊天状态 `messages/pushAgent`（那条通道自 SDD 01 起无 UI 渲染，错误会静默丢失）。
 * 智能体对话本身走 agent-runtime 会话（store/agentSessions），与此无关。
 */
export interface Notice {
  id: number;
  tone: "info" | "crit";
  text: string;
}

interface SessionState {
  // 外壳模式（SDD feats/01）——Focus/Workbench 是同一状态的两种投影，切换零请求
  uiMode: UiMode;
  focusLayout: FocusLayout;

  // 侧边栏 / 面板 / 工具
  sidebarView: View;
  panelTab: PanelTab;
  panelCollapsed: boolean;
  tool: Tool;
  toolOptions: ToolOptions; // SDD 04：工具参数（brush/voi）——查看器不再自持本地 state
  annotations: Annotation[]; // SDD 04：当前对象的标注（/annotations）——与 primitives（Detection）分离

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
  // SDD 08 §11：数据源清单的加载态。failed 必须与「空」区分——把请求失败画成空态卡，
  // 会让用户以为自己没数据而去重新导入，实际是后端没起。
  dsState: "loading" | "ready" | "failed";
  recentItems: RecentItem[]; // SDD 08 §9.4：最近打开过的对象（本地持久化）
  images: ImageMeta[]; // 数据集列表（Explorer）
  naturalImages: ImageMeta[]; // SDD 07：常驻自然图像演示集合（与医学 images 分开）
  volumes: ImageMeta[]; // P6：CT 体积列表
  slides: ImageMeta[]; // P7：WSI slide 列表
  imageMeta: ImageMeta | null; // 当前图元数据（cf/methods 或 voxel_spacing_mm）
  metrics: Record<string, Measure> | null; // 泛型度量（多模态·TaskOutput.metrics）——面板/状态栏/卡片真相源
  primitives: Primitive[]; // 泛型几何原语（多模态·TaskOutput.primitives）——查看器渲染真相源
  source: Source; // 当前叠加来源（agent 模型产出 / human 人工修正）
  modelVersion: string; // 当前结果的模型版本（供卡片/输出栏展示）
  loading: boolean; // 分割/测量进行中
  coords: { x: number; y: number }; // 画布光标坐标（状态栏读出）

  // VLM 连接（智能体连接配置）
  connection: Connection; // VLM 连接（provider/端点/密钥/模型）——localStorage 持久化

  // 即时提示 + Composer 草稿
  notices: Notice[]; // 提示队列：逐条呈现，不互相顶掉（医学失败提示不静默丢失，信任可见 G5）
  composerDraft: string; // Composer 未发送草稿——升入 store 使模式切换重挂载不丢（SDD feats/01 §8/§15）
  composerAttachments: Attachment[]; // 未发送的图像附件，与草稿同理不因重挂载丢失（SDD 00 D-021）
  shortcutSheetOpen: boolean; // 快捷键速查面板开合（SDD feats/05 §9）——瞬态，不持久化
  imagePreview: { src: string; alt: string } | null; // 点击放大的图像（附件缩略图 / 消息图）——瞬态

  // actions
  setUiMode: (m: UiMode) => void;
  setFocusLayout: (patch: Partial<FocusLayout>) => void;
  setSidebarView: (v: View) => void;
  setPanelTab: (t: PanelTab) => void;
  togglePanel: () => void;
  setTool: (t: Tool) => void;
  setToolOptions: (patch: Partial<{ brush: Partial<ToolOptions["brush"]>; voi: Partial<ToolOptions["voi"]> }>) => void;
  setAnnotations: (a: Annotation[]) => void;
  upsertAnnotation: (a: Annotation) => void;
  removeAnnotation: (id: string) => void;
  setTasks: (t: TaskView[]) => void;
  setModality: (m: Modality) => void;
  setActiveImage: (id: string | null) => void;
  setActiveVolume: (id: string | null) => void; // P6
  setActiveSlide: (id: string | null) => void; // P7
  setWsiRoi: (roi: [number, number, number, number] | null) => void; // P7
  setModels: (m: ModelInfo[]) => void;
  setCapabilities: (c: Capability[]) => void;
  setDatasources: (d: DataSource[]) => void;
  setDsState: (s: "loading" | "ready" | "failed") => void;
  setRecentItems: (r: RecentItem[]) => void;
  activateModel: (id: string) => void;
  setImages: (m: ImageMeta[]) => void;
  setNaturalImages: (m: ImageMeta[]) => void;
  setVolumes: (m: ImageMeta[]) => void; // P6
  setSlides: (m: ImageMeta[]) => void; // P7
  setImageMeta: (m: ImageMeta | null) => void;
  setMetrics: (m: Record<string, Measure> | null) => void;
  setPrimitives: (p: Primitive[]) => void;
  setSource: (s: Source) => void;
  setModelVersion: (v: string) => void;
  setLoading: (v: boolean) => void;
  setCoords: (x: number, y: number) => void;
  setConnection: (patch: Partial<Connection>) => void;
  setComposerDraft: (v: string) => void;
  setComposerAttachments: (v: Attachment[]) => void;
  setImagePreview: (v: { src: string; alt: string } | null) => void;
  toggleShortcutSheet: () => void;
  setShortcutSheet: (v: boolean) => void;
  notify: (tone: Notice["tone"], text: string) => void;
  dismissNotice: (id?: number) => void;
}

let _id = 0;
const nextId = () => ++_id;

export const useSession = create<SessionState>((set) => ({
  uiMode: loadUiMode(),
  focusLayout: loadFocusLayout(),

  sidebarView: "explorer",
  panelTab: "meas",
  panelCollapsed: false,
  tool: "cursor",
  toolOptions: { brush: { ...TOOL_OPTIONS_DEFAULTS.brush }, voi: { ...TOOL_OPTIONS_DEFAULTS.voi } },
  annotations: [],

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
  dsState: "loading",
  recentItems: readRecent(),
  images: [],
  naturalImages: [],
  volumes: [],
  slides: [],
  imageMeta: null,
  metrics: null,
  primitives: [],
  source: "agent",
  modelVersion: "",
  loading: false,
  coords: { x: 0, y: 0 },

  connection: loadConnection(),

  notices: [],
  composerDraft: "",
  composerAttachments: [],
  shortcutSheetOpen: false,
  imagePreview: null,

  setUiMode: (requested) =>
    set(() => {
      try {
        localStorage.setItem(UIMODE_KEY, CHAT_EDITION ? "focus" : requested);
      } catch {
        /* 持久化失败不阻塞切换 */
      }
      return { uiMode: CHAT_EDITION ? "focus" : requested };
    }),
  setFocusLayout: (patch) =>
    set((s) => {
      const next = { ...s.focusLayout, ...patch };
      try {
        localStorage.setItem(FOCUS_LAYOUT_KEY, JSON.stringify(next));
      } catch {
        /* noop */
      }
      return { focusLayout: next };
    }),
  setSidebarView: (v) => set({ sidebarView: v }),
  setPanelTab: (t) => set({ panelTab: t }),
  togglePanel: () => set((s) => ({ panelCollapsed: !s.panelCollapsed })),
  setTool: (t) => set({ tool: t }),
  setToolOptions: (patch) =>
    set((s) => ({
      toolOptions: {
        brush: { ...s.toolOptions.brush, ...(patch.brush ?? {}) },
        voi: { ...s.toolOptions.voi, ...(patch.voi ?? {}) },
      },
    })),
  setAnnotations: (a) => set({ annotations: a }),
  upsertAnnotation: (a) =>
    set((s) => {
      const i = s.annotations.findIndex((x) => x.id === a.id);
      if (i < 0) return { annotations: [...s.annotations, a] };
      const next = [...s.annotations];
      next[i] = a;
      return { annotations: next };
    }),
  removeAnnotation: (id) =>
    set((s) => ({ annotations: s.annotations.filter((x) => x.id !== id) })),
  setTasks: (t) => set({ tasks: t }),
  setModality: (m) => set({ modality: m }),
  setActiveImage: (id) => set({ activeImage: id }),
  setActiveVolume: (id) => set({ activeVolume: id }),
  setActiveSlide: (id) => set({ activeSlide: id }),
  setWsiRoi: (roi) => set({ wsiRoi: roi }),
  setModels: (m) => set({ models: m, activeModel: m.find((x) => x.active)?.id ?? "caroSegDeep" }),
  setCapabilities: (c) => set({ capabilities: c }),
  setDatasources: (d) => set({ datasources: d }),
  setDsState: (v) => set({ dsState: v }),
  setRecentItems: (r) => {
    writeRecent(r);
    set({ recentItems: r });
  },
  activateModel: (id) =>
    set((s) => ({
      activeModel: id,
      models: s.models.map((m) => ({ ...m, active: m.id === id })),
    })),
  setImages: (m) => set({ images: m }),
  setNaturalImages: (m) => set({ naturalImages: m }),
  setVolumes: (m) => set({ volumes: m }),
  setSlides: (m) => set({ slides: m }),
  setImageMeta: (m) => set({ imageMeta: m }),
  setMetrics: (m) => set({ metrics: m }),
  setPrimitives: (p) => set({ primitives: p }),
  setSource: (v) => set({ source: v }),
  setModelVersion: (v) => set({ modelVersion: v }),
  setLoading: (v) => set({ loading: v }),
  setCoords: (x, y) => set({ coords: { x, y } }),
  setConnection: (patch) =>
    set((s) => {
      const next = { ...s.connection, ...patch };
      try {
        localStorage.setItem("glaux.connection", JSON.stringify(next));
      } catch {
        /* noop */
      }
      return { connection: next };
    }),
  setComposerDraft: (v) => set({ composerDraft: v }),
  setComposerAttachments: (v) => set({ composerAttachments: v }),
  setImagePreview: (v) => set({ imagePreview: v }),
  toggleShortcutSheet: () => set((s) => ({ shortcutSheetOpen: !s.shortcutSheetOpen })),
  setShortcutSheet: (v) => set({ shortcutSheetOpen: v }),
  // 入队而非覆盖：并发提示逐条呈现；上限 6 条防失控（超出丢最旧，仍保留最近的关键失败）。
  notify: (tone, text) =>
    set((s) => ({ notices: [...s.notices, { id: nextId(), tone, text }].slice(-6) })),
  // 带 id 只移除对应那条（定时器精确关自己，不误伤队列后来者）；不带 id 关掉队首。
  dismissNotice: (id) =>
    set((s) => ({
      notices: id === undefined ? s.notices.slice(1) : s.notices.filter((n) => n.id !== id),
    })),
}));
