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
import { fetchObservation, toObjectCoords } from "../../observation/index.js";
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
      const focus = viewer.focus;
      if (!focus) {
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
      const imageId = focus.object_id;

      const observation = await fetchObservation(base, focus, { signal: combined, fetch: doFetch });
      const image: ImageInput & { mimeType: string } = { data: Buffer.from(observation.bytes).toString("base64"), mimeType: observation.mime };

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
        width: observation.frame.width,
        height: observation.frame.height,
        ...(references.length ? { references } : {}),
        signal: combined,
      });

      const minConfidence = params.min_confidence ?? DEFAULT_MIN_CONFIDENCE;
      const maxResults = params.max_results ?? DEFAULT_MAX_RESULTS;
      const boxes = found.filter((b) => b.confidence >= minConfidence).slice(0, maxResults).map((b) => {
        const r = toObjectCoords(b.box, observation.frame);
        return { ...b, box: [r.x0, r.y0, r.x1, r.y1] as [number, number, number, number] };
      });

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
              `Located "${target}" in ${imageId} (${observation.frame.width}×${observation.frame.height} frame px): ${boxes.length} region(s), ` +
              `most confident first. Coordinates are object pixels [x0, y0, x1, y1].\n${lines.join("\n")}\n` +
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
