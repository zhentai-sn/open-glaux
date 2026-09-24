/**
 * `propose_annotation`——把几何写成**建议态**标注，等人工确认（SDD 02 §6 / §7.3）。
 *
 * 这是 agent 唯一能写进标注体系的出口，也是"绝不自动确认"这条非目标的执行点：
 * 落库一律 `status=suggested` + `source=agent`（backend 对建议态不派发 `on_commit`，
 * 任务副作用要等人工确认那一刻才发生）。转正/驳回由前端确认流做，本工具不提供。
 *
 * 与 `segment_region` 的分工：那边只出候选几何，判断哪些值得标是模型的事——
 * 让它显式再调一次本工具，等于强制它对每条标注做一次独立表态，也给了
 * `permission_mode` 一个天然的门控点（`suggest` 下逐条批准即卡在这里）。
 *
 * 坐标契约（SDD 10 §6.4）：入参为对象像素坐标，与 `segment_region` 出参同一坐标系；
 * 第三轴由 ViewerContext.focus.index 给出，不让模型猜 z / t / level。
 */

import { Type, type Static, type TextContent } from "@earendil-works/pi-ai";
import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";

import { backendBaseUrl } from "../../atlas/client.js";
import type { Index, ViewerContext } from "../../contracts.js";
import { RuntimeError } from "../../errors.js";

export const PROPOSE_ANNOTATION_TOOL_NAME = "propose_annotation";
export const ANNOTATION_PROPOSED_DETAILS_KIND = "glaux.annotation_proposed";

const Point = Type.Tuple([Type.Number(), Type.Number()]);

const ProposeAnnotationParams = Type.Object({
  label: Type.String({
    minLength: 1,
    description: "What this annotation marks, in the user's language (e.g. \"左肾\", \"nucleus\").",
  }),
  bbox: Type.Optional(
    Type.Tuple([Type.Number(), Type.Number(), Type.Number(), Type.Number()], {
      description:
        "Rectangle as [x0, y0, x1, y1] in object pixels. Provide either bbox or polygon, not both.",
    }),
  ),
  polygon: Type.Optional(
    Type.Array(Point, {
      minItems: 3,
      description:
        "Closed outline as [[x, y], ...] in object pixels — typically taken verbatim from segment_region. " +
        "Provide either bbox or polygon, not both.",
    }),
  ),
  note: Type.Optional(
    Type.String({
      description: "Short rationale shown to the user next to the proposal (why you think it is this).",
    }),
  ),
});

export type ProposeAnnotationParams = Static<typeof ProposeAnnotationParams>;

/**
 * `annotation_id` 为 null 表示这次调用没提出任何标注（没开图、几何缺失或退化），
 * 此时 `reason` 说明原因——前端据此不渲染建议卡片，但会话里仍留有痕迹。
 */
export interface AnnotationProposedDetails {
  kind: typeof ANNOTATION_PROPOSED_DETAILS_KIND;
  payload: {
    annotation_id: string | null;
    image_id: string;
    label: string;
    note?: string;
    reason?: string;
    /** 与落库一致的几何，供前端立刻渲染建议态而不必回查。 */
    primitive?: Record<string, unknown>;
    index?: Index;
    seq?: number;
  };
}

function notProposed(
  imageId: string,
  label: string,
  reason: string,
  text: string,
): { content: TextContent[]; details: AnnotationProposedDetails } {
  return {
    content: [{ type: "text", text } satisfies TextContent],
    details: {
      kind: ANNOTATION_PROPOSED_DETAILS_KIND,
      payload: { annotation_id: null, image_id: imageId, label, reason },
    },
  };
}

export interface ProposeAnnotationToolOptions {
  viewer?: ViewerContext;
  backendBaseUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

interface CreatedAnnotation {
  id: string;
  image_id: string;
  primitive: Record<string, unknown>;
  index?: Index;
  seq: number;
  status: string;
  source: string;
}

export function createProposeAnnotationTool(
  options: ProposeAnnotationToolOptions = {},
): AgentHarnessTool<undefined, typeof ProposeAnnotationParams, AnnotationProposedDetails> {
  const doFetch = options.fetch ?? fetch;
  const base = (options.backendBaseUrl ?? backendBaseUrl()).replace(/\/+$/u, "");
  const viewer = options.viewer ?? {};
  const timeoutMs = options.timeoutMs ?? 30_000;

  return {
    name: PROPOSE_ANNOTATION_TOOL_NAME,
    label: "Propose an annotation",
    description:
      "Propose one annotation on the image currently open in the viewer. It appears as a suggestion for the user " +
      "to confirm or reject — it never becomes a confirmed annotation on its own, and confirming is the user's call, " +
      "not yours. Give coordinates in object pixels, normally taken straight from segment_region; propose one region " +
      "per call, and only those you actually judge correct.",
    parameters: ProposeAnnotationParams,
    async execute(_toolCallId, params, signal) {
      const abort = AbortSignal.timeout(timeoutMs);
      const combined = signal ? AbortSignal.any([signal, abort]) : abort;

      const focus = viewer.focus;
      if (!focus) {
        return notProposed(
          "",
          params.label,
          "no_image",
          "No image is open in the viewer, so there is nothing to annotate.",
        );
      }
      const imageId = focus.object_id;

      const hasBbox = Array.isArray(params.bbox);
      const hasPolygon = Array.isArray(params.polygon) && params.polygon.length >= 3;
      if (hasBbox === hasPolygon) {
        // 两个都给或都不给：与其猜一个，不如让模型重来——几何是标注的全部意义
        return notProposed(
          imageId,
          params.label,
          hasBbox ? "ambiguous_geometry" : "missing_geometry",
          hasBbox
            ? "Give either bbox or polygon, not both. Call again with just one."
            : "This needs a geometry: either bbox [x0, y0, x1, y1] or a polygon of at least 3 points, in object pixels.",
        );
      }

      const primitive = hasBbox
        ? bboxPrimitive(params.bbox!)
        : { kind: "polyline", closed: true, points: params.polygon! };
      if (!primitive) {
        return notProposed(
          imageId,
          params.label,
          "degenerate_geometry",
          "That bbox is degenerate (zero width or height). Re-check the coordinates and call again.",
        );
      }

      const res = await doFetch(`${base}/annotations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          image_id: imageId,
          ...(Object.values(focus.index).some((value) => value !== null && value !== undefined) ? { index: focus.index } : {}),
          primitive,
          label: params.label,
          status: "suggested",
          source: "agent",
        }),
        signal: combined,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        // 422 多半是几何越界——把原因如实回给模型，它才能改坐标重试而不是空转
        throw new RuntimeError(
          "annotation_rejected",
          `建议态标注写入失败（HTTP ${res.status}）：${text.replace(/\s+/gu, " ").slice(0, 200)}`,
          res.status === 422 ? 422 : 502,
        );
      }

      const created = ((await res.json()) as { annotation: CreatedAnnotation }).annotation;
      const details: AnnotationProposedDetails = {
        kind: ANNOTATION_PROPOSED_DETAILS_KIND,
        payload: {
          annotation_id: created.id,
          image_id: created.image_id,
          label: params.label,
          ...(params.note?.trim() ? { note: params.note.trim() } : {}),
          primitive: created.primitive,
          index: created.index ?? focus.index,
          seq: created.seq,
        },
      };

      return {
        content: [
          {
            type: "text",
            text:
              `Proposed "${params.label}" on ${imageId} (id ${created.id}). ` +
              "It is now shown to the user as a suggestion awaiting their confirmation — " +
              "do not treat it as an accepted annotation, and do not re-propose the same region.",
          } satisfies TextContent,
        ],
        details,
      };
    },
  };
}

/** bbox 归一化为左上/右下，退化（零宽或零高）返回 null。 */
function bboxPrimitive(
  bbox: [number, number, number, number],
): Record<string, unknown> | null {
  const x0 = Math.min(bbox[0], bbox[2]);
  const x1 = Math.max(bbox[0], bbox[2]);
  const y0 = Math.min(bbox[1], bbox[3]);
  const y1 = Math.max(bbox[1], bbox[3]);
  if (!(x1 > x0) || !(y1 > y0)) return null;
  return { kind: "bbox", x0, y0, x1, y1 };
}
