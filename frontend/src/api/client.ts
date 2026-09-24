// 类型化 API 客户端。走同源 /api（dev 由 Vite 反代到 FastAPI:8000，生产同源部署）。
import type {
  Annotation,
  AnnotationCreated,
  AnnotationInput,
  Calibration,
  Capability,
  DataSource,
  EditRequest,
  Index,
  Measure,
  MeasurementResult,
  Modality,
  ModelInfo,
  ObjectMeta,
  Primitive,
  TaskOutput,
  TaskSpec,
  TaskType,
  TaskView,
  UploadResult,
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

  /** SDD 10：某模态的对象列表（数据轴入口 GET /images?modality= 不变，元素为 ObjectMeta）。 */
  resourceUrl: (path: string) => `${BASE}${path}`,
  objects: (modality: Modality) =>
    get<ObjectMeta[]>(`/images?modality=${encodeURIComponent(modality)}`),
  /** SDD 10 §5.2：任务结果编辑（base_seq 乐观并发，冲突 409）。 */
  objectEdits: (id: string, req: EditRequest) =>
    post<{ metrics: Record<string, Measure>; labelmap_ref: string; seq: number }>(
      `/objects/${encodeURIComponent(id)}/edits`,
      req,
    ),



  imageUrl: (id: string) => `${BASE}/image/${encodeURIComponent(id)}`,

  // --- P7：病理 WSI ---------------------------------------------------------
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
  /** 上传受理后缀，覆盖尚无已注册数据源的模态。 */
  uploadFormats: () => get<{ extensions: string[] }>("/uploads/formats"),
  /**
   * SDD 08/11：浏览器上传一批图片或视频，服务端按格式决定数据源模态。
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
  /** 由编辑后的图元重测；标定收对象的 Calibration（开放集，SDD 10 D-16）。 */
  taskMeasure: (task: TaskType, primitives: Primitive[], calibration: Calibration) =>
    post<MeasurementResult>("/task/measure", { task, primitives, calibration }),

  // --- 统一标注（SDD 04）——bbox/polygon/brush 产物的持久化面 -----------------
  annotations: {
    /** 列出某对象（可选第三轴索引）的当前帧标注。 */
    list: (imageId: string, index?: Index) => {
      const at = index?.z ?? index?.t ?? index?.level;
      return get<{ annotations: Annotation[] }>(
        `/annotations?image_id=${encodeURIComponent(imageId)}${at != null ? `&index_from=${at}&index_to=${at}` : ""}`,
      );
    },
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
