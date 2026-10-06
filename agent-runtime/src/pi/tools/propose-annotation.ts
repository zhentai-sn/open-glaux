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
 * 坐标契约（SDD 10 §6.4）：落库为对象像素坐标；第三轴由 ViewerContext.focus.index 给出，不让模型猜 z / t / level。
 * 入参坐标系由 `space` 显式声明：`object` 为对象像素（与 `segment_region` 出参同一坐标系），
 * `view` 为 `view_current_image` 那张图上的像素——模型照着看到的图描出的坐标，由本工具按取帧的
 * `X-Glaux-Frame` 换算（与 `locate_roi` 同一做法）。低倍概览（如 WSI 的 level 2）与对象像素相差
 * 数十倍，不让模型自己换算。
 */

import type { ToolZh } from "../../i18n/prompt-lang.js";
import { Type, type Static, type TextContent } from "@earendil-works/pi-ai";
import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";

import { backendBaseUrl } from "../../atlas/client.js";
import { fetchObservation } from "../../observation/index.js";
import { objectSize, viewPointToObject, viewRegistryFor, type ViewRegistry } from "./view-registry.js";
import type { Index, ReferenceFrame, ViewerContext } from "../../contracts.js";
import { RuntimeError } from "../../errors.js";

export const PROPOSE_ANNOTATION_TOOL_NAME = "propose_annotation";
export const ANNOTATION_PROPOSED_DETAILS_KIND = "glaux.annotation_proposed";

// 定长数组而非 Type.Tuple：元组生成 `items: [...]`，OpenAI 兼容端点只接受单个 schema 的 `items`，整条请求会被拒
const Point = Type.Array(Type.Number(), { minItems: 2, maxItems: 2 });

const ProposeAnnotationParams = Type.Object({
  label: Type.String({
    minLength: 1,
    description: "What this annotation marks, in the user's language (e.g. \"左肾\", \"nucleus\").",
  }),
  space: Type.String({
    enum: ["view", "object"],
    description:
      "Coordinate system of bbox / polygon. \"view\": pixels of the picture view_current_image showed you — use this " +
      "when you drew the region yourself from what you saw; it is converted for you, even when that picture is a " +
      "downscaled overview. \"object\": object pixels, e.g. a polygon or box copied verbatim from segment_region or locate_roi.",
  }),
  view_id: Type.Optional(Type.String({
    description: "With space \"view\": the view_id of the picture whose pixels you used (view_current_image reports it). "
      + "Defaults to your most recent view.",
  })),
  bbox: Type.Optional(
    Type.Array(Type.Number(), {
      minItems: 4,
      maxItems: 4,
      description: "Rectangle as [x0, y0, x1, y1] in the given space. Provide either bbox or polygon, not both.",
    }),
  ),
  polygon: Type.Optional(
    Type.Array(Point, {
      minItems: 3,
      description: "Closed outline as [[x, y], ...] in the given space. Provide either bbox or polygon, not both.",
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
    /** 所属对象的模态（取自 ViewerContext.collection）；前端据此打开不在舞台上的对象。 */
    modality?: string;
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
  /** 本命令的视图登记（SDD 22 §7.2）。 */
  views?: ViewRegistry;
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
  const views = options.views ?? viewRegistryFor(undefined);

  return {
    name: PROPOSE_ANNOTATION_TOOL_NAME,
    label: "Propose an annotation",
    description:
      "Propose one annotation on the image currently open in the viewer. It appears as a suggestion for the user " +
      "to confirm or reject — it never becomes a confirmed annotation on its own, and confirming is the user's call, " +
      "not yours. Say which coordinate system you use: space \"view\" for pixels of the picture you were shown, " +
      "\"object\" for coordinates copied from segment_region or locate_roi. Propose one region per call, and only " +
      "those you actually judge correct.",
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

      const hasBbox = Array.isArray(params.bbox) && params.bbox.length === 4;
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

      let bbox = params.bbox;
      let polygon = params.polygon as Array<[number, number]> | undefined;
      if (params.space === "view") {
        // SDD 22 §7.2：按模型照着画的那张图换算；未指定时用最近一次视图，本命令尚未看图时按全图概览
        const resolved = await viewFrame(views, params.view_id, () => fetchObservation(base, focus, { signal: combined, fetch: doFetch }).then((o) => o.frame));
        if (typeof resolved === "string") return notProposed(imageId, params.label, "unknown_view", resolved);
        const frame = resolved;
        const size = objectSize(viewer);
        if (bbox) {
          const [ax, ay] = viewPointToObject([bbox[0] ?? Number.NaN, bbox[1] ?? Number.NaN], frame, size);
          const [bx, by] = viewPointToObject([bbox[2] ?? Number.NaN, bbox[3] ?? Number.NaN], frame, size);
          bbox = [ax, ay, bx, by];
        }
        if (polygon) polygon = polygon.map((point) => viewPointToObject(point, frame, size));
      }

      const primitive = hasBbox
        ? bboxPrimitive(bbox!)
        : { kind: "polyline", closed: true, points: polygon! };
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
          ...(viewer.collection ? { modality: viewer.collection } : {}),
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

/**
 * `space: "view"` 的换算基准（SDD 22 §7.2 规则 3）：指定的视图；未指定时最近一次视图；
 * 本命令尚未看图时按全图概览（取帧）。未知视图返回原因文字。
 */
export async function viewFrame(
  views: ViewRegistry,
  viewId: string | undefined,
  overview: () => Promise<ReferenceFrame>,
): Promise<ReferenceFrame | string> {
  if (viewId !== undefined) {
    const view = views.get(viewId);
    return view ? view.frame : `Unknown view_id "${viewId}". Use the view_id that view_current_image reported in this turn.`;
  }
  return views.latest()?.frame ?? overview();
}

/** bbox 归一化为左上/右下，退化（零宽或零高）返回 null。 */
export function bboxPrimitive(
  bbox: readonly number[],
): Record<string, unknown> | null {
  const [ax, ay, bx, by] = bbox;
  if (bbox.length !== 4 || ax === undefined || ay === undefined || bx === undefined || by === undefined) return null;
  if (![ax, ay, bx, by].every(Number.isFinite)) return null;
  const x0 = Math.min(ax, bx);
  const x1 = Math.max(ax, bx);
  const y0 = Math.min(ay, by);
  const y1 = Math.max(ay, by);
  if (!(x1 > x0) || !(y1 > y0)) return null;
  return { kind: "bbox", x0, y0, x1, y1 };
}

/** 中文工具定义（SDD 20 §7.3）。 */
export const PROPOSE_ANNOTATION_ZH: ToolZh = {
  description: "在查看器当前打开的图像上提出一条标注。它以建议的形式出现，由用户确认或拒绝——它永远不会自行成为已确认的标注，确认由用户决定，不由你决定。说明你使用的坐标系：space 为 \"view\" 表示你看到的那张画面的像素，\"object\" 表示从 segment_region 或 locate_roi 复制来的坐标。每次调用提出一个区域，只提出你确实判断正确的区域。",
  parameters: {
    label: "这条标注标记的是什么，用用户的语言（例如 \"左肾\"、\"nucleus\"）。",
    space: "bbox / polygon 的坐标系。\"view\"：view_current_image 给你看的那张画面的像素——你根据所见自己画出区域时用它；即使那张画面是缩小的概览图，也会替你换算。\"object\"：对象像素，例如从 segment_region 或 locate_roi 原样复制的多边形或框。",
    view_id: "space 为 \"view\" 时，你所依据的那张画面的 view_id（view_current_image 会报告）。缺省为你最近一次查看的视图。",
    bbox: "矩形 [x0, y0, x1, y1]，坐标系由 space 指定。bbox 与 polygon 二选一。",
    polygon: "闭合轮廓 [[x, y], ...]，坐标系由 space 指定。bbox 与 polygon 二选一。",
    note: "显示在建议旁、给用户看的简短理由（你为什么认为它是这个）。",
  },
};
