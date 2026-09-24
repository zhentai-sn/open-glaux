/**
 * `segment_region`——把自然语言描述的结构切成精确几何（SDD 02 §6 / §7.2）。
 *
 * 产出**建议态**标注的几何来源：模型说要切什么，本工具调分割后端拿 mask，
 * 在 runtime 侧解码简化成图像像素坐标的多边形（`mask-to-polygon.ts`），
 * 再由 `propose_annotation` 写进前端标注层等人工确认。本工具自身不落库、不改前端状态。
 *
 * 边界（与相邻工具的分工）：
 * - 目标图恒取查看器当前焦点（`viewer.focus`），模型不能指定任意图——
 *   避免它拿到不属于当前上下文的影像；没开图直接告知模型，不猜。
 * - 只做"描述 → 几何"。**不**判断该不该标、**不**写标注，那是 `propose_annotation`。
 * - 精度层路由（SDD 02 §7.2）：science-core 已覆盖的任务走 `run_task`，本工具是
 *   通用场景那一档。裸 SAM3 在医学模态上实测 0 命中（超声/CT/WSI），所以工具描述里
 *   明说它擅长什么——让模型自己选对工具，比事后纠正便宜。
 *
 * 外发门控（SDD 02 §7.4）：托管分割后端会把图发出网，故须 `GLAUX_ANNOT_ALLOW_EGRESS=1`
 * 显式放行；未放行时工具不注册（见 `harness-registry.ts`），而不是运行期才报错——
 * 挂着一个必然失败的工具只会诱导模型反复重试。
 */

import { Type, type Static, type TextContent } from "@earendil-works/pi-ai";
import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";

import { SegmentationClient, type SegmentResult } from "../../annotation/segmentation-client.js";
import type { SegmenterPort } from "../../annotation/segmenter-port.js";
import { backendBaseUrl } from "../../atlas/client.js";
import type { ViewerContext } from "../../contracts.js";
import { fetchObservation, toObjectCoords, toObjectPoint } from "../../observation/index.js";

export const SEGMENT_REGION_TOOL_NAME = "segment_region";
export const SEGMENT_REGION_DETAILS_KIND = "glaux.segment_region";

const SegmentRegionParams = Type.Object({
  target: Type.String({
    minLength: 1,
    description:
      "What to segment, as a short noun phrase in English (e.g. \"left kidney\", \"cell nucleus\"). " +
      "This is matched against the model's open vocabulary — describe the object, not the action.",
  }),
  max_results: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 20,
      description: "Keep at most this many regions, largest first (default 10).",
    }),
  ),
  min_confidence: Type.Optional(
    Type.Number({
      minimum: 0,
      maximum: 1,
      description: "Drop regions below this confidence (default 0.3).",
    }),
  ),
});

export type SegmentRegionParams = Static<typeof SegmentRegionParams>;

/** 一条候选区域；几何为图像像素坐标，前端据此渲染建议态标注。 */
export interface SegmentedRegion {
  label: string;
  confidence: number;
  bbox: [number, number, number, number];
  points: Array<[number, number]>;
  area: number;
}

export interface SegmentRegionDetails {
  kind: typeof SEGMENT_REGION_DETAILS_KIND;
  payload: {
    image_id: string;
    target: string;
    regions: SegmentedRegion[];
    /** 后端命中但被 max_results / min_confidence 滤掉的条数，供卡片如实呈现。 */
    filtered_out: number;
  };
}

export interface SegmentRegionToolOptions {
  viewer?: ViewerContext;
  client?: SegmenterPort;
  backendBaseUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

const DEFAULT_MAX_RESULTS = 10;
const DEFAULT_MIN_CONFIDENCE = 0.3;

/** 分割是否获准把图发往外部后端（SDD 02 §7.4）。缺省关闭——医学影像出网必须显式同意。 */
export function segmentationEgressAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.GLAUX_ANNOT_ALLOW_EGRESS?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function summarize(region: SegmentedRegion, index: number): string {
  const [x0, y0, x1, y1] = region.bbox.map((v) => Math.round(v));
  return (
    `#${index} ${region.label || "region"} — confidence ${region.confidence.toFixed(2)}, ` +
    `bbox [${x0}, ${y0}, ${x1}, ${y1}], ${region.points.length} outline points, ${region.area} px²`
  );
}

export function createSegmentRegionTool(
  options: SegmentRegionToolOptions = {},
): AgentHarnessTool<undefined, typeof SegmentRegionParams, SegmentRegionDetails> {
  const doFetch = options.fetch ?? fetch;
  const base = (options.backendBaseUrl ?? backendBaseUrl()).replace(/\/+$/u, "");
  const viewer = options.viewer ?? {};
  const timeoutMs = options.timeoutMs ?? 60_000;
  // 客户端惰性构造：缺 token 时构造即抛，不该在建会话时炸掉整个工具集
  let client = options.client;
  const clientOf = (): SegmenterPort => {
    client ??= new SegmentationClient(
      { fetch: doFetch, ...(options.timeoutMs ? { timeoutMs } : {}) },
      options.env ?? process.env,
    );
    return client;
  };

  return {
    name: SEGMENT_REGION_TOOL_NAME,
    label: "Segment a region",
    description:
      "Outline a structure in the image currently open in the viewer, given a short description of it. " +
      "Returns pixel-precise polygons (with confidence and bounding box) that can then be proposed as annotations. " +
      "Best for everyday objects and clearly-bounded structures; it is a general-purpose segmenter, not a medical model — " +
      "for calibrated measurements or modality-specific structures (IMT, organ segmentation on CT, nuclei on slides) " +
      "use run_task instead, and say plainly when nothing was found rather than guessing coordinates.",
    parameters: SegmentRegionParams,
    async execute(_toolCallId, params, signal) {
      const abort = AbortSignal.timeout(timeoutMs);
      const combined = signal ? AbortSignal.any([signal, abort]) : abort;

      const target = params.target.trim();
      const focus = viewer.focus;
      if (!focus) {
        return {
          content: [
            {
              type: "text",
              text: "No image is open in the viewer, so there is nothing to segment. Ask the user to open an image first.",
            } satisfies TextContent,
          ],
          // details 恒在：卡片据此如实呈现"没开图"，而不是渲染一个空结果
          details: {
            kind: SEGMENT_REGION_DETAILS_KIND,
            payload: { image_id: "", target, regions: [], filtered_out: 0 },
          },
        };
      }
      const imageId = focus.object_id;

      const maxResults = params.max_results ?? DEFAULT_MAX_RESULTS;
      const minConfidence = params.min_confidence ?? DEFAULT_MIN_CONFIDENCE;

      const observation = await fetchObservation(base, focus, { signal: combined, fetch: doFetch });
      const { bytes } = observation;
      const filename = `${imageId}.${observation.mime === "image/jpeg" ? "jpg" : "png"}`;
      const raw: SegmentResult[] = await clientOf().segment({
        image: bytes,
        filename,
        prompt: target,
        signal: combined,
      });

      const kept = raw
        .filter((r) => r.confidence >= minConfidence)
        .sort((a, b) => b.area - a.area)
        .slice(0, maxResults);
      const regions: SegmentedRegion[] = kept.map((r) => {
        const box = toObjectCoords(r.bbox, observation.frame);
        return {
          label: r.label,
          confidence: r.confidence,
          bbox: [box.x0, box.y0, box.x1, box.y1],
          points: r.points.map((point) => toObjectPoint(point, observation.frame)),
          area: r.area / (observation.frame.scale ** 2),
        };
      });

      const details: SegmentRegionDetails = {
        kind: SEGMENT_REGION_DETAILS_KIND,
        payload: { image_id: imageId, target, regions, filtered_out: raw.length - regions.length },
      };

      if (!regions.length) {
        const hint = raw.length
          ? `${raw.length} region(s) were found but all fell below the confidence threshold (${minConfidence}).`
          : "The segmenter found nothing matching that description in this image.";
        return {
          content: [
            {
              type: "text",
              text:
                `${hint} Do not invent coordinates. Either try a different wording for the target, ` +
                `use run_task if this is a calibrated medical measurement, or tell the user it could not be located.`,
            } satisfies TextContent,
          ],
          details,
        };
      }

      const lines = regions.map((r, i) => summarize(r, i + 1));
      return {
        content: [
          {
            type: "text",
            text:
              `Segmented "${target}" in ${imageId}: ${regions.length} region(s), largest first. ` +
              `Coordinates are object pixels.\n${lines.join("\n")}\n` +
              (details.payload.filtered_out
                ? `(${details.payload.filtered_out} lower-confidence region(s) omitted.)\n`
                : "") +
              "These are candidates, not annotations yet — propose the ones you judge correct so the user can confirm them.",
          } satisfies TextContent,
        ],
        details,
      };
    },
  };
}
