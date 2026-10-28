/**
 * 模型连接探测——测试连通 + 列模型（含视觉能力标注）。
 *
 * 移植自 orchestration/glaux_orchestrator/vlm_providers.py（退役 orchestration P2）。
 * agent-runtime 是唯一与模型说话的进程；前端 ConnectionConfig 的「测试连接 / 拉取模型」
 * 从此走 `/agent-api/v1/connection/*`，backend 不再持有任何模型端点访问逻辑。
 *
 * 视觉能力判定尽力而为、逐 provider（对齐 Python 版）：
 * - anthropic：pi-ai 内置目录（`input` 含 "image"）→ yes；目录外按模型族：
 *   claude-2 / claude-instant / claude-1 → no；其它 claude-* → yes；再兜底名称启发式。
 * - openai-compatible：探到 Ollama（`{root}/api/version` 200）则查 `/api/show` capabilities；
 *   否则名称启发式。**启发式只判 yes，不判 no**（防误杀，让真失败在调用时显式报错）。
 * - opencode：托管端点，地址可省略（缺省 `/zen/v1`，Go 订阅自填 `/zen/go/v1`）；只取 `/models`，
 *   不做 Ollama 探测。视觉判定同样走名称启发式。
 *
 * 出站前一律经 net-guard（SSRF）；密钥只在本次请求内存里存活，不写日志。
 */

import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";

import { RuntimeError } from "../errors.js";
import { assertUrlAllowed, type ResolveHost } from "../security/net-guard.js";
import type { RuntimeProviderId } from "./compatibility.js";

export type ProbeProvider = RuntimeProviderId;
export type Vision = "yes" | "no" | "unknown";

export interface ProbeInput {
  provider: ProbeProvider;
  base_url?: string;
  credential?: string;
}

export interface ProbeTestResult {
  ok: boolean;
  http_status: number | null;
  reason: string;
  model_count?: number;
}

export interface ProbeModelInfo {
  id: string;
  vision: Vision;
  /** 上游自报的上下文窗口；探不到就没有这个字段（前端回退默认值，SDD 00 §4）。 */
  context_window?: number;
  /** 上游自报的最大输出 token；同上，探不到即缺省。 */
  max_tokens?: number;
}

export interface ProbeModelListResult {
  models: ProbeModelInfo[];
  reason?: string;
}

export interface ConnectionProbe {
  test(input: ProbeInput): Promise<ProbeTestResult>;
  listModels(input: ProbeInput): Promise<ProbeModelListResult>;
}

export interface ConnectionProbeDeps {
  fetch?: typeof fetch;
  resolveHost?: ResolveHost;
  env?: NodeJS.ProcessEnv;
  /** 连接 + 读超时（毫秒）。Python 版：连接 3s / 读 8s；此处合并为单次请求上限。 */
  timeoutMs?: number;
}

const ANTHROPIC_DEFAULT_BASE = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";
/** DeepSeek 是 OpenAI 兼容的 `/models`，但地址固定、不接受自填 base_url。 */
const DEEPSEEK_BASE = "https://api.deepseek.com";
/** OpenCode Zen 的缺省端点；Go 订阅由连接自带 `/zen/go/v1`。 */
const OPENCODE_BASE = "https://opencode.ai/zen/v1";
const DEFAULT_TIMEOUT_MS = 8000;

// 名称启发式命中即判有视觉能力（用于无能力元数据的兼容网关 / 作为 Ollama 探测的兜底）。
// 只判 yes，未命中留 unknown——绝不据名判 no。与 Python 版 _VISION_NAME_TOKENS 逐条一致。
const VISION_NAME_TOKENS = [
  "llava", "vision", "gpt-4o", "gpt-4-turbo", "gemini", "pixtral",
  "minicpm-v", "moondream", "bakllava", "cogvlm", "internvl", "granite-vision",
  "qwen-vl", "qwen2-vl", "qwen2.5-vl", "llama-3.2-vision", "-vl", "vl-", ":vl",
  // MiniMax M2 起原生多模态（ViT 编码器，收图与视频），但 id 里没有任何 vl/vision 记号，
  // 单靠通用记号会被判 unknown → 前端按无视觉连接，consult_atlas / locate_roi /
  // view_current_image 全都不注册，用户只会看到"模型看不见图"。
  "minimax-m2", "minimax-m3",
  // DeepSeek v4.1 起为原生多模态（收图），但 pi-ai 0.82.1 的模型目录只到 v4-flash/v4-pro
  // 且都标 input=["text"]，v4.x 新 id 走名称启发式时会被判 unknown → 需要图像的工具全部不挂载。
  // 只列到 v4.1，避免把目录外可能仍是纯文本的 v4 变体误判为有视觉。
  "deepseek-v4.1",
] as const;

export function nameVision(modelId: string): Vision {
  const s = modelId.toLowerCase();
  return VISION_NAME_TOKENS.some((tok) => s.includes(tok)) ? "yes" : "unknown";
}

export function anthropicVision(modelId: string): Vision {
  const known = anthropicProvider()
    .getModels()
    .find((m) => m.id === modelId);
  if (known) return known.input.includes("image") ? "yes" : "no";
  const s = modelId.toLowerCase();
  if (s.startsWith("claude-2") || s.startsWith("claude-instant") || s.startsWith("claude-1")) {
    return "no";
  }
  if (s.startsWith("claude-")) return "yes";
  return nameVision(modelId);
}

/**
 * OpenCode 托管端点也代理 Claude 与 Qwen：`claude-*` 借用 Anthropic 目录的判定，
 * 其余走通用名称启发式（`-vl`、`vision` 等记号）。
 */
export function opencodeVision(modelId: string): Vision {
  return modelId.toLowerCase().startsWith("claude")
    ? anthropicVision(modelId)
    : nameVision(modelId);
}

function positiveInt(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : undefined;
}

// 各家 OpenAI 兼容网关自报元数据的字段名不统一（OpenRouter / LM Studio / vLLM / 自建各写各的），
// 按常见顺序取第一个正整数；一个都没有就留空，交前端回退默认值。
const CONTEXT_KEYS = [
  "context_length",
  "max_context_length",
  "context_window",
  "max_model_len",
  "loaded_context_length",
] as const;
const MAX_TOKENS_KEYS = [
  "max_output_tokens",
  "max_completion_tokens",
  "max_tokens",
] as const;

function pickInt(entry: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const found = positiveInt(entry[key]);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** 从一条 `/models` 记录里挖上下文元数据；OpenRouter 把上限藏在 `top_provider` 里，一并看。 */
/**
 * 从提供商 `/models` 返回的条目里读视觉能力（SDD 00 §4，2026-10-28 修订）。
 *
 * **提供商自报的模态是第一权威**：本地模型目录与名称启发式都会滞后于新模型上线，
 * 拿它们去覆盖提供商明说的话就会得出「模型能看图但工具不挂载」。各网关字段名不统一，
 * 按常见形状逐个探测；都没有才返回 undefined，交调用方兜底。
 */
export function visionFromEntry(entry: Record<string, unknown>): Vision | undefined {
  const hasImage = (value: unknown): boolean => {
    if (typeof value === "string") return value.toLowerCase().includes("image") || value.toLowerCase().includes("vision");
    if (Array.isArray(value)) return value.some(hasImage);
    if (typeof value === "object" && value !== null) return Object.values(value as Record<string, unknown>).some(hasImage);
    return false;
  };

  // 显式布尔/标签
  for (const key of ["supports_vision", "vision", "supports_image_input"]) {
    const v = entry[key];
    if (typeof v === "boolean") return v ? "yes" : "no";
  }
  // 能力数组：capabilities: ["vision"] / ["text", "image"]
  const caps = entry.capabilities;
  if (Array.isArray(caps)) return hasImage(caps) ? "yes" : "no";
  // 模态字段：input_modalities / modalities / architecture.{input_modalities,modality}
  const arch = typeof entry.architecture === "object" && entry.architecture !== null
    ? (entry.architecture as Record<string, unknown>)
    : {};
  for (const key of ["input_modalities", "inputs", "modality"]) {
    if (key in arch) return hasImage(arch[key]) ? "yes" : "no";
  }
  for (const key of ["input_modalities", "inputs", "modalities"]) {
    if (key in entry) return hasImage(entry[key]) ? "yes" : "no";
  }
  // LM Studio 之类的 type 标记
  const type = entry.type;
  if (typeof type === "string" && /vlm|vision|multimodal/iu.test(type)) return "yes";
  return undefined;
}

export function modelMetaFromEntry(entry: Record<string, unknown>): {
  context_window?: number;
  max_tokens?: number;
  vision?: Vision;
} {
  const nested =
    typeof entry.top_provider === "object" && entry.top_provider !== null
      ? (entry.top_provider as Record<string, unknown>)
      : {};
  const contextWindow = pickInt(entry, CONTEXT_KEYS) ?? pickInt(nested, CONTEXT_KEYS);
  const maxTokens = pickInt(entry, MAX_TOKENS_KEYS) ?? pickInt(nested, MAX_TOKENS_KEYS);
  const declared = visionFromEntry(entry);
  return {
    ...(contextWindow === undefined ? {} : { context_window: contextWindow }),
    ...(maxTokens === undefined ? {} : { max_tokens: maxTokens }),
    ...(declared === undefined ? {} : { vision: declared }),
  };
}

function normalizeBase(url: string | undefined, fallback: string): string {
  return (url?.trim() || fallback).replace(/\/+$/u, "");
}

function statusOf(error: unknown): number | null {
  const s = (error as { status?: unknown } | null)?.status;
  return typeof s === "number" ? s : null;
}

function reasonOf(error: unknown): string {
  if (error instanceof RuntimeError) return error.message;
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") return "超时";
    const cause = (error as { cause?: { code?: string } }).cause;
    if (cause?.code === "ECONNREFUSED") return "连接被拒（本地服务未启动？）";
    if (cause?.code === "ENOTFOUND") return `host 解析失败（${cause.code}）`;
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

export function createConnectionProbe(deps: ConnectionProbeDeps = {}): ConnectionProbe {
  const doFetch = deps.fetch ?? fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const env = deps.env ?? process.env;
  const guardOpts = { env, ...(deps.resolveHost ? { resolveHost: deps.resolveHost } : {}) };

  async function get(url: string, headers: Record<string, string>): Promise<Response> {
    return doFetch(url, { method: "GET", headers, signal: AbortSignal.timeout(timeoutMs) });
  }
  async function post(url: string, headers: Record<string, string>, body: unknown): Promise<Response> {
    return doFetch(url, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  // ---- anthropic ---------------------------------------------------------------

  function anthropicHeaders(credential: string | undefined): Record<string, string> {
    const key = credential?.trim() || env.ANTHROPIC_API_KEY || "";
    return {
      ...(key ? { "x-api-key": key } : {}),
      "anthropic-version": ANTHROPIC_VERSION,
    };
  }

  async function anthropicListIds(input: ProbeInput): Promise<{ ids: string[]; status: number }> {
    const base = normalizeBase(input.base_url, ANTHROPIC_DEFAULT_BASE);
    await assertUrlAllowed(base, guardOpts);
    const headers = anthropicHeaders(input.credential);
    const ids: string[] = [];
    let after: string | undefined;
    let status = 200;
    // Anthropic /v1/models 分页（has_more / last_id）；SDK 自动翻页，此处手动等价。
    for (let page = 0; page < 10; page += 1) {
      const url = `${base}/v1/models?limit=100${after ? `&after_id=${encodeURIComponent(after)}` : ""}`;
      const r = await get(url, headers);
      status = r.status;
      if (!r.ok) {
        const err = new Error(`HTTP ${r.status}`) as Error & { status: number };
        err.status = r.status;
        throw err;
      }
      const data = (await r.json()) as {
        data?: { id?: string }[];
        has_more?: boolean;
        last_id?: string | null;
      };
      for (const m of data.data ?? []) if (m?.id) ids.push(m.id);
      if (!data.has_more || !data.last_id) break;
      after = data.last_id;
    }
    return { ids, status };
  }

  // ---- openai-compatible ---------------------------------------------------------

  function bearer(credential: string | undefined): Record<string, string> {
    return credential?.trim() ? { authorization: `Bearer ${credential.trim()}` } : {};
  }

  function ollamaRoot(base: string): string {
    return base.endsWith("/v1") ? base.slice(0, -3) : base;
  }

  async function probeOllama(root: string): Promise<boolean> {
    try {
      const r = await get(`${root}/api/version`, {});
      return r.status === 200;
    } catch {
      return false;
    }
  }

  /** 一次 `/api/show` 同时取视觉能力与上下文窗口（`model_info` 里键名随架构变，取 `*.context_length`）。 */
  async function ollamaShow(
    root: string,
    modelId: string,
  ): Promise<{ vision: Vision; contextWindow?: number }> {
    try {
      const r = await post(`${root}/api/show`, {}, { model: modelId });
      if (r.status !== 200) return { vision: "unknown" };
      const body = (await r.json()) as {
        capabilities?: string[];
        model_info?: Record<string, unknown>;
      };
      const caps = body.capabilities ?? [];
      const vision: Vision = caps.includes("vision")
        ? "yes"
        : caps.length
          ? "no"
          : "unknown";
      const entry = Object.entries(body.model_info ?? {}).find(([key]) =>
        key.endsWith(".context_length"),
      );
      const contextWindow = positiveInt(entry?.[1]);
      return contextWindow === undefined ? { vision } : { vision, contextWindow };
    } catch {
      return { vision: "unknown" };
    }
  }

  async function openaiListIds(
    input: ProbeInput,
  ): Promise<{ ids: string[]; base: string; entries: Map<string, Record<string, unknown>> }> {
    // OpenCode 有缺省端点；其余兼容端点必须由连接给出地址。
    if (input.provider !== "opencode" && !input.base_url?.trim()) {
      throw new RuntimeError("invalid_request", "openai-compatible 需要 base_url", 400);
    }
    const base = normalizeBase(input.base_url, input.provider === "opencode" ? OPENCODE_BASE : "");
    await assertUrlAllowed(base, guardOpts);
    const r = await get(`${base}/models`, bearer(input.credential));
    if (!r.ok) {
      const err = new Error(`HTTP ${r.status}`) as Error & { status: number };
      err.status = r.status;
      throw err;
    }
    const data = (await r.json()) as { data?: Record<string, unknown>[] };
    const ids: string[] = [];
    const entries = new Map<string, Record<string, unknown>>();
    for (const entry of data.data ?? []) {
      const id = typeof entry?.id === "string" ? entry.id : "";
      if (!id) continue;
      ids.push(id);
      entries.set(id, entry);
    }
    return { ids, base, entries };
  }

  function httpReason(status: number | null, provider: ProbeProvider): string | null {
    if (status === 401 || status === 403) return "鉴权失败（密钥无效？）";
    if (status === 404 && (provider === "openai-compatible" || provider === "opencode")) {
      return "端点不存在（base_url 是否含 /v1？）";
    }
    if (status !== null && status >= 400) return `HTTP ${status}`;
    return null;
  }

  return {
    async test(input) {
      try {
        if (input.provider === "anthropic") {
          const { ids } = await anthropicListIds(input);
          return { ok: true, http_status: 200, reason: "ready", model_count: ids.length };
        }
        if (input.provider === "deepseek") {
          const { ids } = await openaiListIds({ ...input, base_url: DEEPSEEK_BASE });
          return { ok: true, http_status: 200, reason: "ready", model_count: ids.length };
        }
        const { ids } = await openaiListIds(input);
        return { ok: true, http_status: 200, reason: "ready", model_count: ids.length };
      } catch (error) {
        if (error instanceof RuntimeError) throw error; // 参数错 / 守卫拒绝 → 4xx 直接抛
        const status = statusOf(error);
        return {
          ok: false,
          http_status: status,
          reason: httpReason(status, input.provider) ?? reasonOf(error),
        };
      }
    },

    async listModels(input) {
      try {
        if (input.provider === "anthropic") {
          const { ids } = await anthropicListIds(input);
          return { models: ids.map((id) => ({ id, vision: anthropicVision(id) })) };
        }
        if (input.provider === "deepseek") {
          // 目录里有的模型直接给出窗口/输出上限；目录外的按名称启发式，窗口留给前端默认值。
          const { ids, entries } = await openaiListIds({ ...input, base_url: DEEPSEEK_BASE });
          const catalog = new Map(deepseekProvider().getModels().map((model) => [model.id, model]));
          return {
            models: ids.map((id) => {
              const entry = entries.get(id) ?? {};
              // 优先级：提供商自报 → 名称启发式（`-vl` 等强记号）→ 本地目录兜底。
              const declared = visionFromEntry(entry);
              if (declared !== undefined) return { id, vision: declared };
              const heuristic = nameVision(id);
              if (heuristic === "yes") return { id, vision: heuristic };
              const known = catalog.get(id);
              return known
                ? {
                    id,
                    vision: (known.input.includes("image") ? "yes" : "no") as Vision,
                    context_window: known.contextWindow,
                    max_tokens: known.maxTokens,
                  }
                : { id, vision: heuristic };
            }),
          };
        }
        const { ids, base, entries } = await openaiListIds(input);
        const root = ollamaRoot(base);
        // OpenCode 是托管端点，不发本地 Ollama 探测（省一次必然 404 的请求）。
        const isOllama = input.provider !== "opencode" && (await probeOllama(root));
        const models: ProbeModelInfo[] = [];
        for (const id of ids) {
          const meta = modelMetaFromEntry(entries.get(id) ?? {});
          // 提供商自报优先（meta.vision），其余再走 Ollama 探测与本地启发式。
          let v: Vision = meta.vision ?? "unknown";
          if (isOllama && v === "unknown") {
            const shown = await ollamaShow(root, id);
            v = shown.vision;
            // Ollama 的 /models 不带窗口，只有 /api/show 有；已从 /models 拿到就不覆盖。
            if (meta.context_window === undefined && shown.contextWindow !== undefined) {
              meta.context_window = shown.contextWindow;
            }
          }
          if (v === "unknown") v = input.provider === "opencode" ? opencodeVision(id) : nameVision(id);
          const { vision: _declared, ...rest } = meta;
          models.push({ id, vision: v, ...rest });
        }
        return { models };
      } catch (error) {
        if (error instanceof RuntimeError) throw error;
        const status = statusOf(error);
        return { models: [], reason: httpReason(status, input.provider) ?? reasonOf(error) };
      }
    },
  };
}
