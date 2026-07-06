// 类型化 API 客户端。走同源 /api（dev 由 Vite 反代到 FastAPI:8000，生产同源部署）。
import type {
  CorrectionResult,
  ImageMeta,
  IMTResult,
  IntentResult,
  ModelInfo,
  SegmentResult,
  TaskResult,
  TaskSpec,
} from "./types";

const BASE = "/api";

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${path} → ${r.status}`);
  return r.json() as Promise<T>;
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  return r.json() as Promise<T>;
}

export const api = {
  interpret: (nl: string, lang: "en" | "zh", opts?: { image_id?: string; cubs_cf?: number }) =>
    post<IntentResult>("/interpret", {
      nl,
      lang,
      has_image: !!opts?.image_id,
      image_id: opts?.image_id,
      cubs_cf: opts?.cubs_cf,
    }),

  run: (spec: TaskSpec) => post<TaskResult>("/run", spec),

  measure: (li: number[][], ma: number[][], cf: number, x_window?: [number, number]) =>
    post<IMTResult>("/measure", { li, ma, cf, x_window }),

  images: (job?: string) => get<ImageMeta[]>(`/images${job ? `?job=${encodeURIComponent(job)}` : ""}`),

  imageUrl: (id: string) => `${BASE}/image/${encodeURIComponent(id)}`,

  models: () => get<ModelInfo[]>("/models"),

  segment: (image_id: string, model: string, roi?: [number, number]) =>
    post<SegmentResult>("/segment", { image_id, model, roi }),

  correction: (image_id: string, which: "LI" | "MA", points: number[][], imt: number) =>
    post<CorrectionResult>("/correction", { image_id, which, points, imt }),
};
