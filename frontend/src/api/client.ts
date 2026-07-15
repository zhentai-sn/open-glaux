// 类型化 API 客户端。走同源 /api（dev 由 Vite 反代到 FastAPI:8000，生产同源部署）。
import type {
  Capability,
  CorrectionResult,
  DataSource,
  Detection,
  ImageMeta,
  IntentBackendInfo,
  IntentResult,
  Measure,
  MeasurementResult,
  Modality,
  ModelInfo,
  Primitive,
  TaskOutput,
  TaskSpec,
  TaskType,
  TaskView,
  VlmModelListResult,
  VlmProvider,
  VlmTestResult,
} from "./types";

/** P6 U4：画笔编辑请求体——slices 是 (z, mask_png_ref, class_id, mode)。 */
export interface VolumeMaskEditSlice {
  z: number;
  /** base64 编码 PNG 二值掩膜（与 z 切片同尺寸）；服务端解 → numpy mask。 */
  mask_png_ref: string;
  class_id: number;
  mode: "paint" | "erase";
}

export interface VolumeMaskEditRequest {
  task: TaskType;
  slices: VolumeMaskEditSlice[];
  method?: string;
  /** 乐观并发：客户端上次见到的编辑序号；落后 → 409（被他人超越）。 */
  base_seq?: number | null;
}

const BASE = "/api";

/** 携带后端错误 reason 的异常（如 VLM 503 不可用）。 */
export class ApiError extends Error {
  status: number;
  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    let detail = `${r.status}`;
    try {
      const j = await r.json();
      if (j?.detail) detail = String(j.detail);
    } catch {
      /* 非 JSON 错误体 */
    }
    throw new ApiError(r.status, detail);
  }
  return r.json() as Promise<T>;
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  return r.json() as Promise<T>;
}

export const api = {
  interpret: (
    nl: string,
    lang: "en" | "zh",
    opts?: {
      image_id?: string;
      cubs_cf?: number;
      backend?: "rule" | "vlm";
      api_key?: string;
      model?: string;
      provider?: VlmProvider;
      base_url?: string;
    },
  ) =>
    post<IntentResult>("/interpret", {
      nl,
      lang,
      has_image: !!opts?.image_id,
      image_id: opts?.image_id,
      cubs_cf: opts?.cubs_cf,
      backend: opts?.backend ?? "rule",
      api_key: opts?.api_key || null,
      model: opts?.model || null,
      provider: opts?.provider ?? "anthropic",
      base_url: opts?.base_url || null,
    }),

  intentBackends: () => get<IntentBackendInfo[]>("/intent/backends"),

  /** 连接测试——ping + 计数（SDD 2026-07-14-001 §5）。 */
  vlmTest: (provider: VlmProvider, base_url?: string, api_key?: string) =>
    post<VlmTestResult>("/intent/vlm/test", {
      provider,
      base_url: base_url || null,
      api_key: api_key || null,
    }),

  /** 拉取模型列表（全列 + 视觉标注）。 */
  vlmModels: (provider: VlmProvider, base_url?: string, api_key?: string) =>
    post<VlmModelListResult>("/intent/vlm/models", {
      provider,
      base_url: base_url || null,
      api_key: api_key || null,
    }),

  images: (modality: Modality = "carotid_imt") =>
    get<ImageMeta[]>(`/images?modality=${encodeURIComponent(modality)}`),

  imageUrl: (id: string) => `${BASE}/image/${encodeURIComponent(id)}`,

  // --- P6：CT 体积数据 ------------------------------------------------------
  /** CT 体积列表——同 /images?modality=ct_abdomen，分端点便于前端 discovery。 */
  volumes: () => get<ImageMeta[]>(`/volumes`),
  /** 原始 NIfTI 字节流（CS3D DICOM image loader 走 wadouri: scheme）。 */
  volumeUrl: (id: string) => `${BASE}/volume/${encodeURIComponent(id)}`,
  /** labelmap NIfTI 字节流（VolumeMask.ref 即此 URL，CS3D SegmentIndex 拉此做渲染）。 */
  volumeLabelmapUrl: (id: string, task: string, method: string) =>
    `${BASE}/volume/${encodeURIComponent(id)}/labelmap?task=${encodeURIComponent(task)}&method=${encodeURIComponent(method)}`,
  /** raw CT NIfTI 引用（用于画笔编辑参考；HU mean 计算走 backend）。 */
  volumeRawUrl: (id: string) => `${BASE}/volume/${encodeURIComponent(id)}/raw`,
  /** 触发 /volume/{id} 的子进程分割（异步返回 task_id 或直接落缓存后返 labelmap_ref）。 */
  volumeSegment: (id: string, task: string, method: string) =>
    post<{ labelmap_ref: string; model_version: string }>(
      `/volume/${encodeURIComponent(id)}/segment`,
      { task, method },
    ),
  /** 画笔编辑回流（U4）：patch labelmap + 度量重算 + 返回 metrics。 */
  volumeMaskEdit: (id: string, payload: VolumeMaskEditRequest) =>
    post<{ metrics: Record<string, Measure>; labelmap_ref: string; seq: number }>(
      `/volume/${encodeURIComponent(id)}/mask-edit`,
      payload,
    ),
  /** Reproducibility Dice 验证（U5）：per-class Dice vs ship 的 reference labelmap。 */
  volumeVerify: (id: string, task: string) =>
    get<{ per_class: Record<string, number> }>(
      `/volume/${encodeURIComponent(id)}/verify?task=${encodeURIComponent(task)}`,
    ),

  // --- P7：病理 WSI ---------------------------------------------------------
  /** WSI slide 列表——同 /images?modality=pathology，分端点便于前端 discovery。 */
  slides: () => get<ImageMeta[]>(`/slides`),
  /** DeepZoom 瓦片 URL（OSD 自定义 tileSource 的 getTileUrl 用；level/col/row 为 DeepZoom 坐标）。 */
  wsiTileUrl: (id: string, level: number, col: number, row: number) =>
    `${BASE}/wsi/${encodeURIComponent(id)}/tile/${level}/${col}/${row}`,
  /** 整片缩略图 URL（OSD 导航图 / discovery 卡片）。 */
  wsiThumbnailUrl: (id: string) => `${BASE}/wsi/${encodeURIComponent(id)}/thumbnail`,
  /** Reproducibility 验证（U5）：与 ship 的 reference（canonical ROI 检测）比质心匹配 F1。 */
  wsiVerify: (id: string, method = "stardist_he") =>
    get<{
      f1: number;
      precision: number;
      recall: number;
      tp: number;
      count_pred: number;
      count_ref: number;
      roi: number[];
      note: string;
    }>(`/wsi/${encodeURIComponent(id)}/verify?method=${encodeURIComponent(method)}`),

  models: () => get<ModelInfo[]>("/models"),

  /** 能力注册表：「插件市场」的单一真相源（模型/数据集/skill/连接器/MCP/知识库，按四层分组）。 */
  capabilities: () => get<Capability[]>("/capabilities"),

  // --- 数据源注册表（表征层 · 文件夹导入） ---------------------------------
  /** 已注册数据源清单（builtin / imported）——dev-mode 标识 + 导入源删除。 */
  datasources: () => get<DataSource[]>("/datasources"),
  /** 导入一个文件夹为数据源。缺 calibration 时后端自动探测（读不出 → needs_calibration）。 */
  importDatasource: (path: string, modality: Modality, calibration?: Record<string, unknown>) =>
    post<DataSource>("/datasources", { path, modality, calibration: calibration ?? null }),
  /** 删除一个导入源（builtin 不可删 → 404）。 */
  removeDatasource: (id: string) =>
    fetch(`${BASE}/datasources/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => {
      if (!r.ok) throw new ApiError(r.status, `DELETE datasource ${id} → ${r.status}`);
      return r.json() as Promise<{ ok: boolean; removed: string }>;
    }),

  correction: (image_id: string, which: "LI" | "MA", points: number[][], imt: number) =>
    post<CorrectionResult>("/correction", { image_id, which, points, imt }),

  // --- 统一驱动（多模态·P2）——注册表 + /task/*，逐步取代上面的逐模态方法 -----
  /** 任务注册表：模态切换器/工具栏/度量字段的单一真相源。 */
  tasks: () => get<TaskView[]>("/tasks"),
  /** 统一驱动：取数 → 测量 → TaskOutput（多模态通吃）。 */
  taskRun: (spec: TaskSpec) => post<TaskOutput>("/task/run", spec),
  /** 只检测几何原语（不测量）。 */
  taskDetect: (spec: TaskSpec) => post<Detection>("/task/detect", spec),
  /** 由编辑后的图元重测（泛型替代 measure + hcMeasure）。 */
  taskMeasure: (task: TaskType, primitives: Primitive[], cf: number) =>
    post<MeasurementResult>("/task/measure", { task, primitives, cf }),
};
