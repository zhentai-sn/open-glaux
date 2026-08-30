// 前端侧的契约类型——镜像 backend/app/schemas.py（§5）。形状是单一事实源，勿擅改。

export type TaskType = "far_wall_cca_imt" | "fetal_hc" | "totalseg_liver_kidney" | "nuclei_detection";
export type Modality = "carotid_imt" | "fetal_hc" | "ct_abdomen" | "pathology" | "natural_image";

export interface TaskSpec {
  task: TaskType;
  image_id?: string | null;
  cubs_cf?: number | null;
  roi?: [number, number] | null;
  /** P7 WSI：框选 ROI (x0, y0, x1, y1) level-0 px（核检测按 ROI 推理，整片不可行）。 */
  roi_box?: [number, number, number, number] | null;
  method?: string | null;
}

export interface ImageMeta {
  id: string;
  center: string;
  cf: number | null;
  methods: string[];
  modality: Modality;
  /** P6：CT 模态用 voxel_spacing_mm 替代 cubs_cf；(sx, sy, sz) mm。 */
  voxel_spacing_mm?: [number, number, number] | null;
  /** P7：WSI 模态用 mpp（(mpp_x, mpp_y) µm/px）。 */
  mpp_um?: [number, number] | null;
  /** P7：WSI level-0 尺寸 (width, height) px（OSD tileSource 用）。 */
  dims?: [number, number] | null;
}

export interface ModelInfo {
  id: string;
  pub: string;
  desc: string;
  active: boolean;
  backend: string;
  modality: Modality;
}

// 能力清单（「插件市场」·§5）——把模型/数据集/skill/连接器/MCP/知识库用「环境四层」收成一套。
export type CapabilityLayer = "representation" | "action" | "verification" | "memory";
export type CapabilityStatus = "active" | "installed" | "planned";

export interface Capability {
  id: string;
  kind: string; // model | adapter | skill | mcp | dataset | connector | reference_method | calibration_source | knowledge_base | correction_store
  layer: CapabilityLayer;
  name: string;
  provider: string;
  license: string;
  status: CapabilityStatus;
  isolation: string;
  desc: string;
  tasks: string[];
}

// --- 数据源（注册表 · 文件夹导入） ------------------------------------------
export type DataSourceOrigin = "builtin" | "imported" | "connector";
export type DataSourceStatus = "active" | "needs_calibration" | "empty" | "planned";

/** 一个已注册的数据源——镜像 backend schemas.DataSourceInfo。 */
export interface DataSource {
  id: string;
  name: string;
  modality: Modality;
  root: string;
  origin: DataSourceOrigin;
  calibration: Record<string, unknown>;
  status: DataSourceStatus;
}

// --- 胎儿头围（HC，闭合轮廓模态） ------------------------------------------

// --- VLM 连接（前端 store 用；探测结果类型见 agent/runtime/types.ts）-----------------------

export type VlmProvider = "anthropic" | "openai_compatible";

export interface VlmModelInfo {
  id: string;
  vision: "yes" | "no" | "unknown";
  /** 上游自报的上下文窗口 / 最大输出；探不到即缺省，选中时回退默认值（SDD 00 §4）。 */
  context_window?: number;
  max_tokens?: number;
}

// --- 统一信封（多模态·P2）——镜像 glaux_core.contracts + /task/* 端点 ---------

export interface Measure {
  value: number;
  unit: string;
  label_en: string;
  label_zh: string;
}

export interface Calibration {
  cf: number;
  source: string;
  provenance: Record<string, unknown>;
}

/** 带类型的几何原语（前端泛型渲染 / 编辑）——kind 判别，镜像 primitive_to_dict。 */
export type Primitive =
  | { kind: "polyline"; id: string; role: string; points: number[][]; closed: boolean }
  | { kind: "ellipse"; id: string; role: string; cx: number; cy: number; a: number; b: number; theta: number }
  | { kind: "mask"; id: string; role: string; ref: string }
  /** SDD 04：轴对齐包围框（通用标注）。镜像 glaux_core.contracts.Bbox。 */
  | { kind: "bbox"; id: string; role: string; x0: number; y0: number; x1: number; y1: number }
  | {
      /** P6：3D 体掩膜（CT labelmap，多类器官，顶层一体）。镜像 glaux_core.contracts.VolumeMask。 */
      kind: "volume_mask";
      id: string;
      ref: string;
      classes: ClassSpec[];
      raw_ref?: string | null;
    }
  | {
      /** P7：点集（病理核检测质心，多类）。镜像 glaux_core.contracts.PointSet。坐标为 level-0 px。 */
      kind: "point_set";
      id: string;
      role: string;
      points: number[][];
      point_class_ids: number[];
      classes: ClassSpec[];
      roi?: number[] | null;
    };

/** VolumeMask 的一个器官类（P6）——颜色/双语标签/是否可量。 */
export interface ClassSpec {
  class_id: number;
  role: string;
  label: Bilingual;
  color: string;
  measurable: boolean;
}

/** 驱动层产物——度量字典 + 待绘几何 + 标定 + provenance（POST /task/run）。 */
export interface TaskOutput {
  task: TaskType;
  metrics: Record<string, Measure>;
  primitives: Primitive[];
  calibration: Calibration;
  provenance: Record<string, unknown>;
}

/** 拖动重测结果（POST /task/measure）。 */
export interface MeasurementResult {
  metrics: Record<string, Measure>;
  calibration: Calibration;
  overlays: Primitive[];
}

// --- 任务注册表视图（GET /tasks）——前端渲染切换器/工具/度量的单一真相源 -------

export interface Bilingual {
  en: string;
  zh: string;
}

export interface TaskMetricDef {
  key: string;
  unit: string;
  label: Bilingual;
}

export interface TaskToolDef {
  id: string;
  glyph: string;
  label: Bilingual;
}

export interface TaskOverlaySpec {
  role: string;
  color: string;
  editable: boolean;
}

export interface TaskView {
  task: TaskType;
  adapter_kind: string;
  modality: Modality;
  label: Bilingual;
  default_method: string;
  viewer: string;
  metrics: TaskMetricDef[];
  tools: TaskToolDef[];
  overlays: TaskOverlaySpec[];
  /** SDD 04：引擎能力位——该任务可用的通用标注工具（wsi 无 brush）。 */
  capabilities: string[];
  /** SDD 04：标注落库后的任务联动钩子（如 WSI bbox → run_task）；无则 null。 */
  on_commit?: Record<string, { action: string }> | null;
}

// --- 统一标注（SDD 04）——/annotations 契约，镜像后端 routers/annotations ------

/** 标注几何原语（bbox / 闭合多边形 / mask 引用）——Annotation 专用，不含任务图元。 */
export type AnnotationPrimitive =
  | { kind: "bbox"; x0: number; y0: number; x1: number; y1: number }
  | { kind: "polyline"; closed: true; points: number[][] }
  | { kind: "mask"; ref: string };

/** 一条标注（人工/agent 的自由产物，与 Detection 任务结果分离）。 */
export interface Annotation {
  id: string;
  image_id: string;
  z?: number | null;
  primitive: AnnotationPrimitive;
  label: string;
  class_id?: number | null;
  status: "draft" | "confirmed" | "suggested" | "rejected";
  source: "manual" | "model" | "agent";
  seq: number;
  created_at?: string;
  updated_at?: string;
}

/** POST /annotations 请求体（mask 的 PNG 走 mask_png_b64）。 */
export interface AnnotationInput {
  image_id: string;
  z?: number | null;
  primitive: AnnotationPrimitive | { kind: "mask" };
  mask_png_b64?: string;
  label?: string;
  class_id?: number | null;
}

/** POST /annotations 响应——hook_result/hook_error 为 on_commit 钩子产物（SDD 04 §7.3）。 */
export interface AnnotationCreated {
  annotation: Annotation;
  hook_result?: TaskOutput | null;
  hook_error?: string | null;
}
