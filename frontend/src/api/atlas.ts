// Atlas（图谱）API 客户端与类型（SDD feats/03 §5.2 / §9）。
// backend 路由前缀 /atlas，经同源 /api 反代；描述生成走 agent-runtime（见 agent/runtime/client.ts）。
import { ApiError } from "./client";

const BASE = "/api/atlas";

export type SourceType = "upload" | "textbook" | "web" | "dataset";
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
  /** 图册路径原文（v1.1，SDD 03 D-20）；"" = 根目录（未分册） */
  collection: string;
  collection_key: string;
  /** 人工修改或确认过（v2.0，SDD 03 §7.8）；false 时描述写回会补标签与空图注 */
  reviewed: boolean;
  score?: number | null;
  matched_tags?: string[];
}

export interface CreateResult {
  exemplar_id: string;
  created: boolean;
}

/** 上传即入库的结果（POST /uploads、/uploads/url，SDD 03 §5.2）：文件级错误不影响同批其它文件。 */
export interface UploadResult {
  batch_id: string;
  items: (CreateResult & { file: string })[];
  errors: { file: string; code: string; message: string }[];
}

export type Roi = [number, number, number, number]; // x, y, w, h（图像像素，左上原点）

export interface EgressConsent {
  confirmed_at: string;
  import_batch_id: string;
  statement_version: string;
}

/** PATCH /exemplars/{id}：字段子集；任何修改都会置 reviewed=true（§7.8 第 4 条）。 */
export interface ExemplarPatch {
  roi?: Roi;
  tags?: string[];
  caption?: string | null;
  notes?: string | null;
  source?: Record<string, unknown>;
  collection?: string | null;
  egress?: Egress;
  egress_consent?: EgressConsent | null;
  reviewed?: true;
}

/** 外发确认声明版本（D-16）；随确认记录保存。 */
export const CONSENT_STATEMENT_VERSION = "v1";

export function newBatchId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function consentRecord(batchId: string): EgressConsent {
  return { confirmed_at: new Date().toISOString(), import_batch_id: batchId, statement_version: CONSENT_STATEMENT_VERSION };
}

export interface TagCount {
  tag: string;
  count: number;
}

/** 图册直属计数（GET /collections）；树由前端拼、子树计数累加。 */
export interface CollectionCount {
  collection: string;
  key: string;
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

function qs(params: Record<string, string | number | boolean | string[] | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (v === "" && k !== "collection") continue; // collection="" 有意义（配合 collection_exact 表示"未分册"）
    if (typeof v === "boolean") {
      p.set(k, String(v)); // reviewed=false 有意义，不能省略
      continue;
    }
    if (Array.isArray(v)) v.forEach((x) => x && p.append(k, x));
    else p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const atlasApi = {
  // --- 上传即入库（v2.0） ---
  upload: (files: File[], collection?: string | null) => {
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f, f.name));
    if (collection) fd.append("collection", collection);
    return req<UploadResult>("/uploads", { method: "POST", body: fd });
  },
  uploadUrl: (url: string, collection?: string | null) =>
    req<UploadResult>("/uploads/url", json("POST", { url, collection: collection || null })),

  // --- 案例 ---
  list: (
    opts: {
      status?: ExemplarStatus | "all";
      tags?: string[];
      source_type?: SourceType;
      collection?: string;
      collection_exact?: boolean;
      describe_status?: DescribeStatus;
      reviewed?: boolean;
      limit?: number;
      offset?: number;
    } = {},
  ) => req<Exemplar[]>(`/exemplars${qs(opts)}`),
  search: (opts: { q?: string; tags?: string[]; egress?: "shareable" | "any"; limit?: number; collection?: string }) =>
    req<Exemplar[]>(`/exemplars/search${qs(opts)}`),
  tags: (status: ExemplarStatus | "all" = "active") => req<TagCount[]>(`/tags${qs({ status })}`),
  collections: (status: ExemplarStatus | "all" = "active") => req<CollectionCount[]>(`/collections${qs({ status })}`),
  patch: (id: string, changes: ExemplarPatch) =>
    req<Exemplar>(`/exemplars/${encodeURIComponent(id)}`, json("PATCH", changes)),
  addRegion: (id: string, roi: Roi) =>
    req<CreateResult>(`/exemplars/${encodeURIComponent(id)}/regions`, json("POST", { roi })),
  get:(id: string) => req<Exemplar>(`/exemplars/${encodeURIComponent(id)}`),
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
