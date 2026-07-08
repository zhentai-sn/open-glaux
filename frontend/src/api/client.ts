// 类型化 API 客户端。走同源 /api（dev 由 Vite 反代到 FastAPI:8000，生产同源部署）。
import type {
  Capability,
  CorrectionResult,
  Detection,
  ImageMeta,
  IntentBackendInfo,
  IntentResult,
  MeasurementResult,
  Modality,
  ModelInfo,
  Primitive,
  TaskOutput,
  TaskSpec,
  TaskType,
  TaskView,
} from "./types";

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
    }),

  intentBackends: () => get<IntentBackendInfo[]>("/intent/backends"),

  images: (modality: Modality = "carotid_imt") =>
    get<ImageMeta[]>(`/images?modality=${encodeURIComponent(modality)}`),

  imageUrl: (id: string) => `${BASE}/image/${encodeURIComponent(id)}`,

  models: () => get<ModelInfo[]>("/models"),

  /** 能力注册表：「插件市场」的单一真相源（模型/数据集/skill/连接器/MCP/知识库，按四层分组）。 */
  capabilities: () => get<Capability[]>("/capabilities"),

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
