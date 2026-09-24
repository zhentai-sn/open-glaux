// 前端侧的契约类型——镜像 backend/app/schemas.py（§5）。形状是单一事实源，勿擅改。

// SDD 10 规则 10 / D-14：模态字面量比较清零之后放宽为 string，取值由后端注册表决定（SOURCES / REGISTRY）。
export type TaskType = string;
export type Modality = string;

// --- 视觉对象（SDD 10 §9.1）——镜像 backend schemas.ObjectMeta 等 ---------------------

/** kind = 几何族（引擎/解码/校验的分派键）。modality = 数据集路由键。二者不互换（D-3）。 */
export type ObjectKind = "image" | "volume" | "slide" | "video";
export type AxisName = "x" | "y" | "z" | "t" | "level";
export interface Axis {
  name: AxisName;
  size: number;
  spacing?: number | null;
  unit?: string;
}

/** 开放集：前端按已知 kind 渲染，未知 kind 只显示 source（D-16）。 */
export interface Calibration {
  kind: "mm_per_px" | "voxel_mm" | "mpp_um" | "time_base" | (string & {});
  value: unknown;
  source: string;
  provenance?: Record<string, unknown>;
}

/** 与 axes 正交的附加流声明（D-23）。SDD 11 冻结观测形状前不得消费（§7 规则 22）。 */
export interface Stream {
  kind: "audio" | (string & {});
  sample_rate?: number | null;
  channels?: number | null;
  duration_ms?: number | null;
  codec?: string | null;
}

export interface MethodRef {
  name: string;
  role: "gold" | "agent" | "reference";
}

export interface ObjectMeta {
  id: string;
  kind: ObjectKind;
  modality: Modality;
  source_id: string;
  display_name: string;
  axes: Axis[];
  calibration: Calibration | null;
  /** 后端下发的 URL 模板；前端不拼路径（§7 规则 3）。 */
  resources: { frame: string; raw?: string; tiles?: string; audio?: string };
  streams: Stream[];
  methods: MethodRef[];
  /** 自由元数据；原 center 在此（meta.center）。 */
  meta: Record<string, unknown>;
}

export interface Index {
  z?: number | null;
  t?: number | null;
  level?: number | null;
}
export type Region =
  | { kind: "box"; x0: number; y0: number; x1: number; y1: number }
  | { kind: "column_window"; x0: number; x1: number }
  | { kind: "slice"; z: number }
  | { kind: "frame_range"; t0: number; t1: number; seed?: { t: number; box: [number, number, number, number] } };
/** 当前观测焦点——前端 store 唯一写入，runtime 只读（D-4）。 */
export interface Focus {
  object_id: string;
  kind: ObjectKind;
  index: Index;
  region: Region | null;
}
export interface ReferenceFrame {
  object_id: string;
  index: Index;
  origin: [number, number];
  scale: number;
  width: number;
  height: number;
}

export interface TaskSpec {
  task: TaskType;
  /** 字段名保留，语义为对象 id（D-8）。 */
  image_id?: string | null;
  method?: string | null;
  calibration?: Calibration | null;
  region?: Region | null;
}

/** `/objects/{id}/edits` 请求体（SDD 10 §5.2）。 */
export interface EditRequest {
  task: TaskType;
  method: string;
  base_seq: number;
  ops: { index: Index; class_id: number; mode: "paint" | "erase"; mask_png: string }[];
}

export interface ModelInfo {
  id: string;
  pub: string;
  desc: string;
  active: boolean;
  backend: string;
  modality: Modality;
}

// 能力清单（「插件市场」·§5）——把模型/数据集/skill/连接器/MCP/知识库按环境四要素收成一套（layer 取值沿用 representation/action/verification/memory）。
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
  /** SDD 10 §9.3：几何族、标签（label_key 优先 → label → modality 原文）、可上传后缀。 */
  kind: ObjectKind;
  label: string;
  label_key: string;
  importable: string[];
  /** SDD 10 §9.4：无 TaskPlugin 模态的能力位默认集；有任务的模态为空（以 TaskView 为准）。 */
  default_capabilities: string[];
}

// --- 浏览器图像上传（SDD 08 §9.2） ------------------------------------------

/** 被拒原因；与后端 enum 同集合。 */
export type UploadRejectReason = "unsupported_type" | "too_large" | "corrupt";

export interface UploadAccepted {
  id: string;
  /** 客户端原始文件名，仅用于回显——它不参与任何路径与 ID（后端 D-7）。 */
  filename: string;
  bytes: number;
}

export interface UploadRejected {
  filename: string;
  reason: UploadRejectReason;
}

export interface UploadResult {
  source: DataSource;
  accepted: UploadAccepted[];
  rejected: UploadRejected[];
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

/** 任务产物里的标定结果（镜像 calibration_to_dict），与对象的 ``Calibration`` 不同物。 */
export interface CalibrationResult {
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
  calibration: CalibrationResult;
  provenance: Record<string, unknown>;
}

/** 拖动重测结果（POST /task/measure）。 */
export interface MeasurementResult {
  metrics: Record<string, Measure>;
  calibration: CalibrationResult;
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
  key?: string;
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
  metrics: TaskMetricDef[];
  tools: TaskToolDef[];
  overlays: TaskOverlaySpec[];
  /** SDD 04：引擎能力位——该任务可用的通用标注工具（wsi 无 brush）。 */
  capabilities: string[];
  /** SDD 04：标注落库后的任务联动钩子（如 WSI bbox → run_task）；无则 null。 */
  on_commit?: Record<string, { action: string }> | null;
  /** SDD 10：任务接受的几何族（run_task 门控，D-13）。 */
  object_kinds: ObjectKind[];
  /** SDD 10：打开对象时的触发策略；无 TaskView 的模态按 manual（D-18）。 */
  trigger: "on_open" | "on_region" | "manual";
  classes?: ClassSpec[];
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
  index?: Index;
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
  index?: Index;
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
