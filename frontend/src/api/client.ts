// 类型化 API 客户端。走同源 /api（dev 由 Vite 反代到 FastAPI:8000，生产同源部署）。
import type {
  Annotation,
  AnnotationCreated,
  AnnotationInput,
  Capability,
  DataSource,
  ImageMeta,
  Measure,
  MeasurementResult,
  Modality,
  ModelInfo,
  Primitive,
  TaskOutput,
  TaskSpec,
  TaskType,
  TaskView,
  UploadResult,
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

async function patch<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(BASE + path, {
    method: "PATCH",
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

async function del(path: string): Promise<void> {
  const r = await fetch(BASE + path, { method: "DELETE" });
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
}

export const api = {
  // 意图解析（/interpret）与连接探测（/intent/vlm/*）已退役：NL 走 agent-runtime 会话，
  // 智能体经 run_task 工具调 /task/run；连接测试见 agentRuntimeApi.testConnection / listModels。

  images: (modality: Modality = "carotid_imt") =>
    get<ImageMeta[]>(`/images?modality=${encodeURIComponent(modality)}`),

  /** SDD 07：固定自然照片，仅供通用 SAM / 标注走查，不对应 science-core 任务。 */
  naturalImages: () => get<ImageMeta[]>(`/images?modality=natural_image`),

  imageUrl: (id: string) => `${BASE}/image/${encodeURIComponent(id)}`,

  // --- P6：CT 体积数据 ------------------------------------------------------
  /** CT 体积列表——同 /images?modality=ct_abdomen，分端点便于前端 discovery。 */
  volumes: () => get<ImageMeta[]>(`/volumes`),
  /** 原始 NIfTI 字节流（CS3D DICOM image loader 走 wadouri: scheme）。 */
  volumeUrl: (id: string) => `${BASE}/volume/${encodeURIComponent(id)}`,
  // labelmap 字节流由后端在 VolumeMask.ref 里直接下发绝对 URL，前端不拼；分割统一走 taskRun。
  /** 画笔编辑回流（U4）：patch labelmap + 度量重算 + 返回 metrics。 */
  volumeMaskEdit: (id: string, payload: VolumeMaskEditRequest) =>
    post<{ metrics: Record<string, Measure>; labelmap_ref: string; seq: number }>(
      `/volume/${encodeURIComponent(id)}/mask-edit`,
      payload,
    ),

  // --- P7：病理 WSI ---------------------------------------------------------
  /** WSI slide 列表——同 /images?modality=pathology，分端点便于前端 discovery。 */
  slides: () => get<ImageMeta[]>(`/slides`),
  /** DeepZoom 瓦片 URL（OSD 自定义 tileSource 的 getTileUrl 用；level/col/row 为 DeepZoom 坐标）。 */
  wsiTileUrl: (id: string, level: number, col: number, row: number) =>
    `${BASE}/wsi/${encodeURIComponent(id)}/tile/${level}/${col}/${row}`,
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

  /** 能力注册表：「插件市场」的单一真相源（模型/数据集/skill/连接器/MCP/知识库，按环境四要素分组）。 */
  capabilities: () => get<Capability[]>("/capabilities"),

  // --- 数据源注册表（观测空间 · 文件夹导入） ---------------------------------
  /** 已注册数据源清单（builtin / imported）——dev-mode 标识 + 导入源删除。 */
  datasources: () => get<DataSource[]>("/datasources"),
  /** 导入一个文件夹为数据源。缺 calibration 时后端自动探测（读不出 → needs_calibration）。 */
  importDatasource: (path: string, modality: Modality, calibration?: Record<string, unknown>) =>
    post<DataSource>("/datasources", { path, modality, calibration: calibration ?? null }),
  /** SDD 08：显式加载仓库自带的示例数据源。幂等；无示例时返回空数组而非报错。 */
  loadSamples: () => post<DataSource[]>("/datasources/samples", {}),
  /**
   * SDD 08：浏览器上传一批 JPEG/PNG 为通用图像数据源。
   * 不手写 Content-Type——multipart 的 boundary 必须由浏览器生成，写死会让后端解析不出分段。
   */
  uploadImages: (files: File[], name?: string) => {
    const form = new FormData();
    for (const f of files) form.append("files", f);
    if (name) form.append("name", name);
    return fetch(`${BASE}/uploads/images`, { method: "POST", body: form }).then(async (r) => {
      if (!r.ok) throw new ApiError(r.status, await r.text());
      return r.json() as Promise<UploadResult>;
    });
  },
  /** 删除一个导入源（builtin 不可删 → 404）。 */
  removeDatasource: (id: string) =>
    fetch(`${BASE}/datasources/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => {
      if (!r.ok) throw new ApiError(r.status, `DELETE datasource ${id} → ${r.status}`);
      return r.json() as Promise<{ ok: boolean; removed: string }>;
    }),

  // --- 统一驱动（多模态·P2）——注册表 + /task/*，逐步取代上面的逐模态方法 -----
  /** 任务注册表：模态切换器/工具栏/度量字段的单一真相源。 */
  tasks: () => get<TaskView[]>("/tasks"),
  /** 统一驱动：取数 → 测量 → TaskOutput（多模态通吃）。 */
  taskRun: (spec: TaskSpec) => post<TaskOutput>("/task/run", spec),
  /** 由编辑后的图元重测（泛型替代 measure + hcMeasure）。 */
  taskMeasure: (task: TaskType, primitives: Primitive[], cf: number) =>
    post<MeasurementResult>("/task/measure", { task, primitives, cf }),

  // --- 统一标注（SDD 04）——bbox/polygon/brush 产物的持久化面 -----------------
  annotations: {
    /** 列出某对象（可选 z 层）的全部标注。 */
    list: (imageId: string, z?: number | null) =>
      get<{ annotations: Annotation[] }>(
        `/annotations?image_id=${encodeURIComponent(imageId)}${z != null ? `&z=${z}` : ""}`,
      ),
    /** 创建标注；on_commit 钩子产物在 hook_result/hook_error。 */
    create: (input: AnnotationInput) => post<AnnotationCreated>("/annotations", input),
    /** 更新几何/标签/状态（base_seq 乐观并发；过期 → 409）。 */
    update: (
      id: string,
      body: {
        base_seq: number;
        primitive?: unknown;
        mask_png_b64?: string;
        label?: string;
        class_id?: number | null;
        /** 建议态确认/驳回（SDD 02）：suggested → confirmed / rejected。 */
        status?: Annotation["status"];
      },
    ) => patch<{ annotation: Annotation; hook_result?: unknown; hook_error?: string | null }>(
      `/annotations/${encodeURIComponent(id)}`,
      body,
    ),
    /** 删除（base_seq 乐观并发；mask 文件连带删）。 */
    remove: (id: string, baseSeq: number) =>
      del(`/annotations/${encodeURIComponent(id)}?base_seq=${baseSeq}`),
    /** mask 标注的 PNG 栅格 URL（reload 后叠色渲染）。 */
    maskUrl: (id: string) => `${BASE}/annotations/${encodeURIComponent(id)}/mask`,
  },
};
