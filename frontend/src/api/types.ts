// 前端侧的契约类型——镜像 backend/app/schemas.py（§5）。形状是单一事实源，勿擅改。

export type Scope = "in_scope" | "ambiguous" | "out_of_scope";
export type TaskType = "far_wall_cca_imt" | "fetal_hc";
export type Modality = "carotid_imt" | "fetal_hc";

export interface TaskSpec {
  task: TaskType;
  image_id?: string | null;
  cubs_cf?: number | null;
  roi?: [number, number] | null;
  method?: string | null;
}

export interface IntentResult {
  scope: Scope;
  spec?: TaskSpec | null;
  reason: string;
  backend: string;
}

export interface IMTResult {
  mean_mm: number;
  max_mm: number;
  pdm_mean_mm: number;
  per_column_um: number[];
  n_columns: number;
}

export interface TaskResult extends IMTResult {
  cf: number;
  cf_source: string;
  model_version: string;
  roi?: [number, number] | null;
  vs_a1_um?: number | null;
}

export interface ImageMeta {
  id: string;
  center: string;
  cf: number | null;
  methods: string[];
  modality: Modality;
}

export interface ModelInfo {
  id: string;
  pub: string;
  desc: string;
  active: boolean;
  backend: string;
  modality: Modality;
}

// --- 胎儿头围（HC，闭合轮廓模态） ------------------------------------------

export interface HCEllipse {
  cx: number;
  cy: number;
  a: number; // 半长轴
  b: number; // 半短轴
  theta: number; // 长轴相对 +x 的旋转（弧度）
}

export interface HCResult {
  hc_mm: number;
  bpd_mm: number;
  ofd_mm: number;
  area_mm2: number;
  ellipse: HCEllipse;
  n_points: number;
}

export interface HCRunResult extends HCResult {
  cf: number;
  model_version: string;
  contour: [number, number][];
  vs_gt_mm: number | null;
}

export interface SegmentResult {
  li: [number, number][];
  ma: [number, number][];
  model_version: string;
}

export interface CorrectionResult {
  ok: boolean;
  provenance: Record<string, unknown>;
}

export interface IntentBackendInfo {
  id: "rule" | "vlm";
  name: string;
  available: boolean;
  reason: string;
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
  | { kind: "mask"; id: string; role: string; ref: string };

export interface Detection {
  primitives: Primitive[];
  model_version: string;
  roi_used: [number, number] | null;
  meta: Record<string, unknown>;
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
}
