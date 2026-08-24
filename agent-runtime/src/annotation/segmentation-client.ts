/**
 * 分割后端客户端（SDD 02 §7.2 路由的"托管 API"档）。
 *
 * 首个后端：Gitee AI（模力方舟）`sam3` serverless。`POST {base}/images/segmentation`，
 * multipart 上传图 + 文本 prompt，返回 `segments[]{label, confidence, bbox, mask}`，
 * mask 为 `COCO_RLE_base64`，由 `mask-to-polygon.ts` 在 runtime 侧解码成多边形。
 *
 * 2026-08-24 实测记录（决定了本文件的几处写法，换后端时须重新核对）：
 * - **`prompt` 实际必传**，其 OpenAPI schema 完全未声明该字段；缺失时返回
 *   HTTP 400 `必传参数: prompt`。
 * - **`mask.size` 实为 `[width, height]`**，与 schema 声明的 `[height, width]` 相反。
 * - 正常延迟 2.0–2.4s（1.3MB 图）；13 次调用中出现 1 次 120s 无响应 → 默认超时 30s + 重试一次。
 * - 余额不足时同样是 HTTP 400（非 402），报文含"计费资源"——单独映射为可读错误码，
 *   否则会被当成参数错误反复重试。
 * - **医学模态实测 0 命中**（超声/CT/WSI 多组中英文 prompt 均 `num_segments: 0`）：
 *   裸 SAM3 的开放词表建立在自然图像概念上。医学场景须走 science-core 或本地
 *   医学微调权重（SDD 02 §7.2 精度层路由），本客户端只负责通用场景那一档。
 *
 * 出网提醒：调用本客户端会把图像发往外部服务，须由调用方先过 `GLAUX_ANNOT_ALLOW_EGRESS`
 * 门控（SDD 02 §7.4）；`local-only` 的图谱案例与敏感影像不得走这条路。
 */

import { RuntimeError } from "../errors.js";
import { maskToPolygon, type Point2, type RleMask } from "./mask-to-polygon.js";

export interface SegmentationClientOptions {
  /** 服务根地址，缺省读 `GLAUX_SEG_API_URL`，再缺省为模力方舟 `https://ai.gitee.com/v1`。 */
  baseUrl?: string;
  /** 访问令牌，缺省读 `GLAUX_SEG_API_TOKEN`。缺失时构造即抛，避免裸调用打到 401。 */
  token?: string;
  /** 模型名，缺省读 `GLAUX_SEG_API_MODEL`，再缺省 `sam3`。 */
  model?: string;
  fetch?: typeof fetch;
  /** 单次请求超时，缺省 30s（实测正常 2.4s，留足抖动余量）。 */
  timeoutMs?: number;
  /** 超时/5xx 的重试次数，缺省 1。 */
  retries?: number;
}

export interface SegmentInput {
  /** 图像字节（由调用方从 backend 取，runtime 不直连查看器）。 */
  image: Uint8Array;
  /** 上传文件名，只影响服务端的 MIME 猜测，缺省 `image.png`。 */
  filename?: string;
  /** 文本 prompt——**必传**，见文件头实测记录。 */
  prompt: string;
  signal?: AbortSignal;
}

/** 一个分割结果：几何已转成图像像素坐标的多边形，mask 不外泄。 */
export interface SegmentResult {
  label: string;
  confidence: number;
  /** 后端自报的包围盒 `[x0,y0,x1,y1]`（浮点）。 */
  bbox: [number, number, number, number];
  /** 由 mask 解码简化得到的闭合多边形（图像像素坐标）。 */
  points: Point2[];
  /** mask 前景像素数，可用于按面积过滤碎片。 */
  area: number;
}

interface RawSegment {
  id?: number;
  label?: string;
  confidence?: number;
  bbox?: number[];
  mask?: RleMask;
}

export function segApiBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.GLAUX_SEG_API_URL?.trim() || "https://ai.gitee.com/v1";
}

export class SegmentationClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retries: number;

  constructor(options: SegmentationClientOptions = {}, env: NodeJS.ProcessEnv = process.env) {
    this.baseUrl = (options.baseUrl ?? segApiBaseUrl(env)).replace(/\/+$/u, "");
    const token = options.token ?? env.GLAUX_SEG_API_TOKEN?.trim() ?? "";
    if (!token) {
      throw new RuntimeError(
        "segmentation_not_configured",
        "分割后端未配置：需设置 GLAUX_SEG_API_TOKEN",
        503,
      );
    }
    this.token = token;
    this.model = options.model ?? env.GLAUX_SEG_API_MODEL?.trim() ?? "sam3";
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.retries = options.retries ?? 1;
  }

  /** 文本 prompt 分割。返回已转多边形的结果；后端 0 命中时返回空数组（不是错误）。 */
  async segment(input: SegmentInput): Promise<SegmentResult[]> {
    if (!input.prompt.trim()) {
      // 提前拦下：该字段 schema 未声明但服务端必查，本地报错比 400 往返更清楚
      throw new RuntimeError("invalid_argument", "segment 需要非空 prompt", 400);
    }

    const body = new FormData();
    body.set("model", this.model);
    body.set("prompt", input.prompt.trim());
    // `Uint8Array.from` 重新装进独占的 ArrayBuffer——入参可能背靠 SharedArrayBuffer，
    // 那种 buffer 不被 Blob 接受（TS 也会拒），复制一份最省心
    body.set("image", new Blob([Uint8Array.from(input.image)]), input.filename ?? "image.png");

    const raw = await this.post(body, input.signal);
    const segments = Array.isArray(raw.segments) ? (raw.segments as RawSegment[]) : [];
    const results: SegmentResult[] = [];
    for (const s of segments) {
      if (!s.mask) continue;
      if (s.mask.encoding !== "COCO_RLE_base64") {
        throw new RuntimeError(
          "segmentation_failed",
          `未知的 mask 编码：${s.mask.encoding}`,
          502,
        );
      }
      const { points, area } = maskToPolygon(s.mask);
      if (!area || points.length < 3) continue; // 空/退化 mask 丢弃
      results.push({
        label: typeof s.label === "string" ? s.label : "",
        confidence: typeof s.confidence === "number" ? s.confidence : 0,
        bbox: normalizeBbox(s.bbox),
        points,
        area,
      });
    }
    return results;
  }

  private async post(body: FormData, signal?: AbortSignal): Promise<Record<string, unknown>> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const timeout = AbortSignal.timeout(this.timeoutMs);
      const merged = signal ? AbortSignal.any([signal, timeout]) : timeout;
      try {
        const res = await this.fetchImpl(`${this.baseUrl}/images/segmentation`, {
          method: "POST",
          headers: { authorization: `Bearer ${this.token}` },
          body,
          signal: merged,
        });
        if (res.ok) return (await res.json()) as Record<string, unknown>;

        const text = await res.text().catch(() => "");
        // 余额不足也是 400，报文含"计费资源"——重试无用，单独抛出可读错误
        if (/计费资源|余额|quota|insufficient/iu.test(text)) {
          throw new RuntimeError("segmentation_quota_exhausted", `分割后端额度不足：${brief(text)}`, 402);
        }
        if (res.status >= 400 && res.status < 500) {
          throw new RuntimeError("segmentation_failed", `分割请求被拒绝（HTTP ${res.status}）：${brief(text)}`, 502);
        }
        lastError = new RuntimeError("segmentation_failed", `分割后端 HTTP ${res.status}：${brief(text)}`, 502);
      } catch (error) {
        // 4xx 与额度类错误不重试；超时与 5xx 走下一轮
        if (error instanceof RuntimeError && error.code !== "segmentation_failed") throw error;
        if (error instanceof RuntimeError && /HTTP 4\d\d/u.test(error.message)) throw error;
        if (signal?.aborted) throw error;
        lastError = error;
      }
    }
    throw lastError instanceof RuntimeError
      ? lastError
      : new RuntimeError("segmentation_failed", `分割后端不可用：${String(lastError)}`, 502);
  }
}

function normalizeBbox(bbox: number[] | undefined): [number, number, number, number] {
  if (!Array.isArray(bbox) || bbox.length < 4) return [0, 0, 0, 0];
  return [bbox[0]!, bbox[1]!, bbox[2]!, bbox[3]!];
}

function brief(text: string): string {
  return text.replace(/\s+/gu, " ").slice(0, 200);
}
