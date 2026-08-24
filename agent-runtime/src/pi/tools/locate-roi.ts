/**
 * `locate_roi`——文字描述 → 图像里的位置（SDD 02 §6 / §7.2）。
 *
 * 与 `segment_region` 的分工，按"谁认识医学结构"划：
 * - `locate_roi` 走**视觉模型 grounding**：模型自己看图指位置，能理解"膜性肾病的电子致密物"
 *   这类领域概念，也能吃图谱先验；代价是只出矩形框、精度到不了像素级。
 * - `segment_region` 走**分割后端**：出像素级多边形，但裸 SAM3 的开放词表建立在自然图像上，
 *   医学模态实测 0 命中（2026-08-24：超声/CT/WSI 多组 prompt 全空）。
 * 所以医学结构先用本工具定位；要精确边界，再把框交给分割或 `run_task`。
 *
 * 图谱先验（SDD 03 §6.3 / D-21）：`use_atlas` 打开时先经 `selectExemplars` 挑 1–3 条案例
 * 作为参考图，与目标图一起送进模型——这就是 03 设计的"两步"，`consult_atlas` 承担第一步，
 * 本工具承担第二步。检索链原样复用，不另起一套。
 *
 * 无外发门控：图只发往用户自己配的模型连接（与会话同一条），不经第三方分割服务；
 * 但 local-only 图谱案例是否随行，仍由 `egressFor(connection)` 判定（本机模型才带）。
 */

import { randomUUID } from "node:crypto";

import { Type, type Static, type TextContent } from "@earendil-works/pi-ai";
import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";

import { AtlasClient, backendBaseUrl, egressFor } from "../../atlas/client.js";
import { selectExemplars } from "../../atlas/select.js";
import type { AtlasReferencedPayload, ConnectionInput, ViewerContext } from "../../contracts.js";
import { RuntimeError } from "../../errors.js";
import { locateInImage, type ImageInput, type LocatedBox, type VisionRuntime } from "../vision.js";

export const LOCATE_ROI_TOOL_NAME = "locate_roi";
export const ROI_LOCATED_DETAILS_KIND = "glaux.roi_located";

const LocateRoiParams = Type.Object({
  target: Type.String({
    minLength: 1,
    description:
      "The structure to locate, described the way a specialist would name it " +
      "(e.g. \"electron-dense deposits\", \"左侧颈动脉斑块\").",
  }),
  use_atlas: Type.Optional(
    Type.Boolean({
      description:
        "Look up atlas reference cases for this structure first and show them to yourself before locating " +
        "(default true). Turn it off only when the structure is unmistakable without precedent.",
    }),
  ),
  max_results: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 10, description: "Keep at most this many boxes (default 5)." }),
  ),
  min_confidence: Type.Optional(
    Type.Number({ minimum: 0, maximum: 1, description: "Drop boxes below this confidence (default 0.2)." }),
  ),
});

export type LocateRoiParams = Static<typeof LocateRoiParams>;

export interface RoiLocatedDetails {
  kind: typeof ROI_LOCATED_DETAILS_KIND;
  payload: {
    image_id: string;
    target: string;
    boxes: LocatedBox[];
    filtered_out: number;
    /** 用了图谱先验时带上，供会话渲染"参考图谱 N 条"卡片（与 consult_atlas 同一契约）。 */
    atlas?: AtlasReferencedPayload;
  };
}

export interface LocateRoiToolOptions {
  runtime: VisionRuntime;
  connection: Pick<ConnectionInput, "provider" | "base_url">;
  viewer?: ViewerContext;
  client?: AtlasClient;
  backendBaseUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

const DEFAULT_MAX_RESULTS = 5;
const DEFAULT_MIN_CONFIDENCE = 0.2;

interface FetchedImage extends ImageInput {
  /** 取图后恒有值（响应头缺失时退到 image/png），故收窄为必填。 */
  mimeType: string;
  width: number;
  height: number;
}

/**
 * 取查看器当前图，尺寸直接从字节里读。
 *
 * 尺寸是归一化坐标乘回像素的分母，错了整套坐标全错——所以宁可失败也不猜默认值。
 * 不另开 `/meta` 端点：backend 的 `/image/{id}` 恒返回 PNG，头部就有尺寸，
 * 少一次往返，也不依赖 backend 是否"认识"该对象（其 dims 解析对未知对象返回 None）。
 */
async function fetchImage(
  doFetch: typeof globalThis.fetch,
  base: string,
  imageId: string,
  signal: AbortSignal,
): Promise<FetchedImage> {
  const res = await doFetch(`${base}/image/${encodeURIComponent(imageId)}`, { signal });
  if (!res.ok) {
    throw new RuntimeError("image_unavailable", `取图失败：HTTP ${res.status}（image_id=${imageId}）`, 502);
  }
  const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
  const bytes = new Uint8Array(await res.arrayBuffer());
  const dims = readImageSize(bytes);
  if (!dims) {
    throw new RuntimeError(
      "image_unavailable",
      `无法解析图像尺寸（image_id=${imageId}，${mimeType}）——归一化坐标无从换算`,
      502,
    );
  }
  return { data: Buffer.from(bytes).toString("base64"), mimeType, ...dims };
}

/** 从 PNG / JPEG 字节头读 (width, height)；无法识别返回 null。 */
export function readImageSize(bytes: Uint8Array): { width: number; height: number } | null {
  // PNG：8 字节签名 + IHDR（长度 4 + 类型 4），宽高是紧随其后的两个大端 uint32
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  // JPEG：扫段找 SOF0..SOF15（跳过 SOF4/SOF8/SOF12 这三个非帧标记）
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let p = 2;
    while (p + 9 < bytes.length) {
      if (bytes[p] !== 0xff) {
        p += 1;
        continue;
      }
      const marker = bytes[p + 1]!;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = (bytes[p + 5]! << 8) | bytes[p + 6]!;
        const width = (bytes[p + 7]! << 8) | bytes[p + 8]!;
        return width > 0 && height > 0 ? { width, height } : null;
      }
      p += 2 + ((bytes[p + 2]! << 8) | bytes[p + 3]!);
    }
  }
  return null;
}

export function createLocateRoiTool(
  options: LocateRoiToolOptions,
): AgentHarnessTool<undefined, typeof LocateRoiParams, RoiLocatedDetails> {
  const doFetch = options.fetch ?? fetch;
  const base = (options.backendBaseUrl ?? backendBaseUrl()).replace(/\/+$/u, "");
  const viewer = options.viewer ?? {};
  const timeoutMs = options.timeoutMs ?? 90_000;
  const client =
    options.client ??
    new AtlasClient({ baseUrl: base, fetch: doFetch, ...(options.timeoutMs ? { timeoutMs } : {}) });

  return {
    name: LOCATE_ROI_TOOL_NAME,
    label: "Locate a region",
    description:
      "Find where a described structure is in the image currently open in the viewer, using your own vision plus " +
      "curated atlas examples. Returns bounding boxes in image pixels with confidence. This is the tool for " +
      "domain structures a general segmenter does not know (findings on ultrasound, CT, EM, slides). " +
      "It gives rectangles, not exact outlines — follow up with run_task for calibrated measurement, or " +
      "propose_annotation to put the box in front of the user. Returns nothing when the structure is not visible; " +
      "say so plainly instead of inventing a location.",
    parameters: LocateRoiParams,
    async execute(_toolCallId, params, signal) {
      const abort = AbortSignal.timeout(timeoutMs);
      const combined = signal ? AbortSignal.any([signal, abort]) : abort;

      const target = params.target.trim();
      const imageId = viewer.image_id;
      if (!imageId) {
        return {
          content: [
            {
              type: "text",
              text: "No image is open in the viewer, so there is nothing to locate in. Ask the user to open one.",
            } satisfies TextContent,
          ],
          details: {
            kind: ROI_LOCATED_DETAILS_KIND,
            payload: { image_id: "", target, boxes: [], filtered_out: 0 },
          },
        };
      }

      const image = await fetchImage(doFetch, base, imageId, combined);

      // 第一步（可选）：翻图谱取先验。检索失败不该让定位落空——没有先验也能定位。
      let atlas: AtlasReferencedPayload | undefined;
      let references: { id: string; image: ImageInput; summary?: string }[] = [];
      if (params.use_atlas !== false) {
        try {
          const egress = await egressFor(options.connection);
          const picked = await selectExemplars(options.runtime, client, {
            q: target,
            egress,
            target: { data: image.data, mimeType: image.mimeType },
            traceId: randomUUID(),
            k: 3,
            signal: combined,
          });
          atlas = picked.event;
          references = picked.selected.map((e) => ({
            id: e.exemplar_id,
            image: { data: e.crop_base64, mimeType: "image/png" },
            ...(e.caption ? { summary: e.caption } : {}),
          }));
          if (picked.selected.length) {
            await client
              .markReferenced(picked.selected.map((e) => e.exemplar_id), picked.event.trace_id, combined)
              .catch(() => undefined);
          }
        } catch {
          /* 图谱不可用：退化为无先验定位（SDD 03 D-13：簿记失败不阻断主流程） */
        }
      }

      // 第二步：带着（可能有的）先验做 grounding
      const found = await locateInImage(options.runtime, {
        image: { data: image.data, mimeType: image.mimeType },
        target,
        width: image.width,
        height: image.height,
        ...(references.length ? { references } : {}),
        signal: combined,
      });

      const minConfidence = params.min_confidence ?? DEFAULT_MIN_CONFIDENCE;
      const maxResults = params.max_results ?? DEFAULT_MAX_RESULTS;
      const boxes = found.filter((b) => b.confidence >= minConfidence).slice(0, maxResults);

      const details: RoiLocatedDetails = {
        kind: ROI_LOCATED_DETAILS_KIND,
        payload: {
          image_id: imageId,
          target,
          boxes,
          filtered_out: found.length - boxes.length,
          ...(atlas ? { atlas } : {}),
        },
      };

      if (!boxes.length) {
        const hint = found.length
          ? `${found.length} candidate box(es) were below the confidence threshold (${minConfidence}).`
          : `"${target}" does not appear to be visible in this image.`;
        return {
          content: [
            {
              type: "text",
              text:
                `${hint} Do not invent a location. Tell the user it could not be found, ` +
                `or ask them to point at it if they can see it.`,
            } satisfies TextContent,
          ],
          details,
        };
      }

      const lines = boxes.map((b, i) => {
        const [x0, y0, x1, y1] = b.box.map((v) => Math.round(v));
        return `#${i + 1} [${x0}, ${y0}, ${x1}, ${y1}] — confidence ${b.confidence.toFixed(2)}${b.why ? ` — ${b.why}` : ""}`;
      });
      return {
        content: [
          {
            type: "text",
            text:
              `Located "${target}" in ${imageId} (${image.width}×${image.height} px): ${boxes.length} region(s), ` +
              `most confident first. Coordinates are image pixels [x0, y0, x1, y1].\n${lines.join("\n")}\n` +
              (references.length ? `Informed by ${references.length} atlas reference case(s). ` : "") +
              (details.payload.filtered_out
                ? `(${details.payload.filtered_out} low-confidence box(es) omitted.) `
                : "") +
              "These are your own estimates — propose the ones you stand behind so the user can confirm them.",
          } satisfies TextContent,
        ],
        details,
      };
    },
  };
}
