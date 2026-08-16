// Atlas（图谱）API 客户端与类型（SDD feats/03 §5.2 / §9）。
// backend 路由前缀 /atlas，经同源 /api 反代；描述生成走 agent-runtime（见 agent/runtime/client.ts）。
import { ApiError } from "./client";

const BASE = "/api/atlas";

export type SourceType = "textbook" | "web" | "dataset";
export type Egress = "shareable" | "local-only";
export type ExemplarStatus = "active" | "retired";
export type DescribeStatus = "done" | "pending" | "skipped";

/** VLM 结构化描述（SDD §7.6 模板：固定字段 + extra）。 */
export interface AtlasDescription {
  modality: string;
  subject: string;
  findings: { name: string; location?: string; appearance?: string }[];
  pattern: string;
  summary: string;
  extra: Record<string, unknown>;
}

export interface Exemplar {
  exemplar_id: string;
  image_ref: string;
  crop_ref: string | null;
  image_sha256: string;
  roi: [number, number, number, number];
  geometry: number[][] | null;
  tags: string[];
  tags_raw: string[];
  caption: string | null;
  notes: string | null;
  description: AtlasDescription | Record<string, unknown> | null;
  describe_status: DescribeStatus;
  source_type: SourceType;
  source: Record<string, unknown>;
  egress: Egress;
  egress_consent: Record<string, unknown> | null;
  status: ExemplarStatus;
  created_at: string;
  import_batch_id: string;
  score?: number | null;
  matched_tags?: string[];
}

export interface ImportCandidate {
  index: number;
  width: number;
  height: number;
  caption: string;
  nearby: string[];
  locator: Record<string, unknown>;
}

export interface ImportSession {
  import_id: string;
  source_type: SourceType;
  origin: Record<string, unknown>;
  figures: ImportCandidate[];
}

export interface ExemplarInput {
  roi: [number, number, number, number];
  tags: string[];
  source_type: SourceType;
  source: Record<string, unknown>;
  egress: Egress;
  egress_consent?: { confirmed_at: string; import_batch_id: string; statement_version: string } | null;
  caption?: string | null;
  notes?: string | null;
  geometry?: number[][] | null;
  import_id?: string;
  figure_index?: number;
  image_base64?: string;
}

export interface CreateResult {
  exemplar_id: string;
  created: boolean;
}

export interface TagCount {
  tag: string;
  count: number;
}

/** 后端错误体 detail 为 {code, message}（routers/atlas.py `_err`）；把 code 提到异常上。 */
export class AtlasApiError extends ApiError {
  code: string;
  constructor(status: number, code: string, message: string) {
    super(status, message);
    this.code = code;
  }
}

async function parseError(r: Response): Promise<never> {
  let code = `HTTP_${r.status}`;
  let message = `${r.status}`;
  try {
    const j = (await r.json()) as { detail?: unknown };
    const d = j?.detail;
    if (d && typeof d === "object") {
      const dd = d as { code?: unknown; message?: unknown };
      if (typeof dd.code === "string") code = dd.code;
      if (typeof dd.message === "string") message = dd.message;
    } else if (typeof d === "string") {
      message = d;
    }
  } catch {
    /* 非 JSON 错误体 */
  }
  throw new AtlasApiError(r.status, code, message);
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(BASE + path, init);
  if (!r.ok) return parseError(r);
  return r.json() as Promise<T>;
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

function qs(params: Record<string, string | number | string[] | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) v.forEach((x) => x && p.append(k, x));
    else p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const atlasApi = {
  // --- 导入（候选暂存，不入库） ---
  importPdf: (file: File) => {
    const fd = new FormData();
    fd.append("file", file, file.name);
    return req<ImportSession>("/imports/pdf", { method: "POST", body: fd });
  },
  importUrl: (url: string) => req<ImportSession>("/imports/url", json("POST", { url })),
  getImport: (importId: string) => req<ImportSession>(`/imports/${encodeURIComponent(importId)}`),
  importFigureUrl: (importId: string, index: number) =>
    `${BASE}/imports/${encodeURIComponent(importId)}/figures/${index}`,
  discardImport: (importId: string) =>
    req<{ ok: boolean }>(`/imports/${encodeURIComponent(importId)}`, { method: "DELETE" }),

  // --- 案例 ---
  create: (items: ExemplarInput[], importBatchId?: string) =>
    req<CreateResult[]>("/exemplars", json("POST", { items, import_batch_id: importBatchId ?? null })),
  list: (opts: { status?: ExemplarStatus | "all"; tags?: string[]; source_type?: SourceType; limit?: number; offset?: number } = {}) =>
    req<Exemplar[]>(`/exemplars${qs(opts)}`),
  search: (opts: { q?: string; tags?: string[]; egress?: "shareable" | "any"; limit?: number }) =>
    req<Exemplar[]>(`/exemplars/search${qs(opts)}`),
  tags: (status: ExemplarStatus | "all" = "active") => req<TagCount[]>(`/tags${qs({ status })}`),
  get: (id: string) => req<Exemplar>(`/exemplars/${encodeURIComponent(id)}`),
  imageUrl: (id: string) => `${BASE}/exemplars/${encodeURIComponent(id)}/image`,
  cropUrl: (id: string) => `${BASE}/exemplars/${encodeURIComponent(id)}/crop`,
  setDescription: (id: string, description: AtlasDescription | null, status: DescribeStatus = "done") =>
    req<Exemplar>(`/exemplars/${encodeURIComponent(id)}/description`, json("PUT", { description, status })),
  retire: (id: string) => req<{ ok: boolean }>(`/exemplars/${encodeURIComponent(id)}/retire`, { method: "POST" }),
  restore: (id: string) => req<{ ok: boolean }>(`/exemplars/${encodeURIComponent(id)}/restore`, { method: "POST" }),
  remove: (id: string) => req<{ ok: boolean }>(`/exemplars/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

/** 取裁剪图为 base64（喂给 runtime describe）。 */
export async function fetchCropBase64(id: string): Promise<string> {
  const r = await fetch(atlasApi.cropUrl(id));
  if (!r.ok) return parseError(r);
  const buf = await r.arrayBuffer();
  let bin = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
