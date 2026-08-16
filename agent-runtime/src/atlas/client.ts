/**
 * backend `/atlas/*` 的 runtime 侧客户端（SDD 03 §5.2 / §7.4）。
 *
 * 目标固定为本机 backend（同 run-task.ts：不套 SSRF 守卫）。
 * `egressFor(connection)` 决定检索时的外发档位：只有连接的 base_url 解析为回环（本地模型）
 * 才允许 `any`（含 local-only 案例）；托管 provider 一律 `shareable`。判定在 runtime，backend 不猜。
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import type { ConnectionInput } from "../contracts.js";
import { RuntimeError } from "../errors.js";
import { classifyIp } from "../security/net-guard.js";

export type Egress = "shareable" | "any";

export interface AtlasExemplar {
  exemplar_id: string;
  image_ref: string;
  crop_ref: string | null;
  roi: [number, number, number, number];
  geometry: number[][] | null;
  tags: string[];
  tags_raw: string[];
  caption: string | null;
  notes: string | null;
  description: Record<string, unknown> | null;
  describe_status: string;
  source_type: string;
  source: Record<string, unknown>;
  egress: "shareable" | "local-only";
  status: string;
  created_at: string;
  score: number | null;
  matched_tags: string[];
}

export interface AtlasSearchInput {
  tags?: string[];
  q?: string;
  egress: Egress;
  limit?: number;
  signal?: AbortSignal;
}

export interface AtlasClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function backendBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.GLAUX_BACKEND_URL?.trim() || "http://127.0.0.1:8000";
}

export class AtlasClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: AtlasClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? backendBaseUrl()).replace(/\/+$/u, "");
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  private signalFor(signal?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  }

  async search(input: AtlasSearchInput): Promise<AtlasExemplar[]> {
    const params = new URLSearchParams();
    if (input.q?.trim()) params.set("q", input.q.trim());
    for (const t of input.tags ?? []) if (t.trim()) params.append("tags", t.trim());
    params.set("egress", input.egress);
    params.set("limit", String(input.limit ?? 10));
    const res = await this.fetchImpl(`${this.baseUrl}/atlas/exemplars/search?${params}`, {
      signal: this.signalFor(input.signal),
    });
    if (!res.ok) throw new RuntimeError("atlas_unavailable", `atlas search failed: HTTP ${res.status}`, 502);
    return (await res.json()) as AtlasExemplar[];
  }

  /** 取裁剪图（无裁剪则原图）作为 base64。 */
  async fetchCropBase64(exemplarId: string, signal?: AbortSignal): Promise<string> {
    const res = await this.fetchImpl(
      `${this.baseUrl}/atlas/exemplars/${encodeURIComponent(exemplarId)}/crop`,
      { signal: this.signalFor(signal) },
    );
    if (!res.ok) throw new RuntimeError("atlas_unavailable", `atlas crop failed: HTTP ${res.status}`, 502);
    return Buffer.from(await res.arrayBuffer()).toString("base64");
  }

  async markReferenced(exemplarIds: string[], traceId: string, signal?: AbortSignal): Promise<void> {
    if (!exemplarIds.length) return;
    const res = await this.fetchImpl(`${this.baseUrl}/atlas/exemplars/referenced`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ exemplar_ids: exemplarIds, trace_id: traceId }),
      signal: this.signalFor(signal),
    });
    if (!res.ok) throw new RuntimeError("atlas_unavailable", `atlas referenced failed: HTTP ${res.status}`, 502);
  }
}

/**
 * 连接是否指向本机模型：base_url 的 host 全部解析为回环 → `any`；否则 `shareable`。
 * anthropic 无 base_url 视为托管。解析失败保守取 `shareable`。
 */
export async function egressFor(
  connection: Pick<ConnectionInput, "provider" | "base_url">,
  resolveHost: (host: string) => Promise<string[]> = defaultResolve,
): Promise<Egress> {
  const raw = connection.base_url?.trim();
  if (!raw) return "shareable";
  let host: string;
  try {
    host = new URL(raw).hostname.replace(/^\[|\]$/gu, "");
  } catch {
    return "shareable";
  }
  if (!host) return "shareable";
  try {
    const ips = await resolveHost(host);
    return ips.length > 0 && ips.every((ip) => classifyIp(ip).loopback) ? "any" : "shareable";
  } catch {
    return "shareable";
  }
}

async function defaultResolve(host: string): Promise<string[]> {
  if (isIP(host)) return [host];
  const records = await lookup(host, { all: true, verbatim: true });
  return records.map((r) => r.address);
}
