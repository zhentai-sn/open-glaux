/**
 * `revise_annotation`（SDD 22 §7.4）：修改或撤回智能体自己提出、尚未被用户处理的建议。
 *
 * 放大复核发现框偏了，原地改那条建议，而不是再留下一条新的——否则错框和对框并排等用户挑。
 * 只认 `source=agent` 且 `status=suggested`：人画的、已确认或已驳回的标注一律不动。
 * 写入沿用 backend 的 `base_seq` 乐观并发；冲突时把原因交回模型，由它重新查看后再决定。
 */

import type { ToolZh } from "../../i18n/prompt-lang.js";
import { Type, type Static, type TextContent } from "@earendil-works/pi-ai";
import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";

import { backendBaseUrl } from "../../atlas/client.js";
import type { ViewerContext } from "../../contracts.js";
import { fetchObservation } from "../../observation/index.js";
import { bboxPrimitive, viewFrame } from "./propose-annotation.js";
import { objectSize, viewPointToObject, viewRegistryFor, type ViewRegistry } from "./view-registry.js";

export const REVISE_ANNOTATION_TOOL_NAME = "revise_annotation";
export const ANNOTATION_REVISED_DETAILS_KIND = "glaux.annotation_revised";

const Point = Type.Array(Type.Number(), { minItems: 2, maxItems: 2 });

const ReviseAnnotationParams = Type.Object({
  annotation_id: Type.String({ minLength: 1, description: "The suggestion to revise (an id you proposed in this conversation)." }),
  action: Type.String({
    enum: ["update", "withdraw"],
    description: "\"update\" changes its geometry and/or label; \"withdraw\" removes the suggestion.",
  }),
  space: Type.Optional(Type.String({
    enum: ["view", "object"],
    description: "Coordinate system of the new bbox / polygon, as in propose_annotation.",
  })),
  view_id: Type.Optional(Type.String({ description: "With space \"view\": the view whose pixels you used. Defaults to your most recent view." })),
  bbox: Type.Optional(Type.Array(Type.Number(), { minItems: 4, maxItems: 4, description: "New rectangle [x0, y0, x1, y1]; only for a box suggestion." })),
  polygon: Type.Optional(Type.Array(Point, { minItems: 3, description: "New closed outline [[x, y], ...]; only for a polygon suggestion." })),
  label: Type.Optional(Type.String({ minLength: 1, description: "New label, if it should change." })),
  note: Type.Optional(Type.String({ description: "Short reason for the revision, shown to the user." })),
});

export type ReviseAnnotationParams = Static<typeof ReviseAnnotationParams>;

export interface AnnotationRevisedDetails {
  kind: typeof ANNOTATION_REVISED_DETAILS_KIND;
  annotation_id: string;
  action: "update" | "withdraw";
  image_id: string;
  /** 本次未改动时为原因（拒绝、冲突、几何无效），前端不据此改查看器。 */
  reason?: string;
  note?: string;
  /** `update` 成功后的标注，与 backend 返回一致。 */
  annotation?: Record<string, unknown>;
}

export interface ReviseAnnotationToolOptions {
  viewer?: ViewerContext;
  backendBaseUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  views?: ViewRegistry;
}

interface StoredAnnotation {
  id: string;
  image_id: string;
  primitive: Record<string, unknown> & { kind?: string };
  seq: number;
  status: string;
  source: string;
  label?: string;
}

export function createReviseAnnotationTool(
  options: ReviseAnnotationToolOptions = {},
): AgentHarnessTool<undefined, typeof ReviseAnnotationParams, AnnotationRevisedDetails> {
  const doFetch = options.fetch ?? fetch;
  const base = (options.backendBaseUrl ?? backendBaseUrl()).replace(/\/+$/u, "");
  const viewer = options.viewer ?? {};
  const timeoutMs = options.timeoutMs ?? 30_000;
  const views = options.views ?? viewRegistryFor(undefined);

  return {
    name: REVISE_ANNOTATION_TOOL_NAME,
    label: "Revise a suggestion",
    description:
      "Change or withdraw a suggestion you proposed earlier and the user has not yet confirmed or rejected. " +
      "Use it after zooming in shows your box or outline is off — revise the same suggestion instead of proposing " +
      "a second one. You cannot change annotations drawn by the user or ones already confirmed or rejected.",
    parameters: ReviseAnnotationParams,
    async execute(_toolCallId, params, signal) {
      const abort = AbortSignal.timeout(timeoutMs);
      const combined = signal ? AbortSignal.any([signal, abort]) : abort;
      const action = params.action === "withdraw" ? "withdraw" : "update";
      const focus = viewer.focus;
      const imageId = focus?.object_id ?? "";
      const answer = (text: string, extra: Partial<AnnotationRevisedDetails> = {}) => ({
        content: [{ type: "text", text } satisfies TextContent],
        details: { kind: ANNOTATION_REVISED_DETAILS_KIND, annotation_id: params.annotation_id, action, image_id: imageId, ...extra } as AnnotationRevisedDetails,
      });

      if (!focus) return answer("No image is open in the viewer, so there is nothing to revise.", { reason: "no_image" });

      const listed = await doFetch(`${base}/annotations?image_id=${encodeURIComponent(imageId)}`, { signal: combined });
      if (!listed.ok) return answer(`Could not read the annotations (HTTP ${listed.status}); nothing was changed.`, { reason: "unavailable" });
      const current = ((await listed.json()) as { annotations: StoredAnnotation[] }).annotations.find((a) => a.id === params.annotation_id);
      if (!current) {
        return answer(`There is no annotation ${params.annotation_id} on the open image; nothing was changed.`, { reason: "not_found" });
      }
      if (current.source !== "agent" || current.status !== "suggested") {
        return answer(
          `${params.annotation_id} is ${current.status} and made by ${current.source}; you can only revise your own suggestions ` +
            "that the user has not handled yet. Nothing was changed.",
          { reason: "not_revisable" },
        );
      }

      if (action === "withdraw") {
        const res = await doFetch(`${base}/annotations/${encodeURIComponent(current.id)}?base_seq=${current.seq}`, { method: "DELETE", signal: combined });
        if (res.status === 409) return answer("It changed while you were working; look at it again before deciding.", { reason: "conflict" });
        if (!res.ok) return answer(`Withdrawing failed (HTTP ${res.status}); nothing was changed.`, { reason: "failed" });
        return answer(`Withdrew suggestion ${current.id}. It is no longer shown to the user.`, {
          ...(params.note?.trim() ? { note: params.note.trim() } : {}),
        });
      }

      // update：几何可选；给了几何就必须与原来的类型一致（backend 不允许换类型）
      let primitive: Record<string, unknown> | undefined;
      const hasBbox = Array.isArray(params.bbox) && params.bbox.length === 4;
      const hasPolygon = Array.isArray(params.polygon) && params.polygon.length >= 3;
      if (hasBbox && hasPolygon) return answer("Give either bbox or polygon, not both. Nothing was changed.", { reason: "ambiguous_geometry" });
      if (hasBbox || hasPolygon) {
        const wanted = hasBbox ? "bbox" : "polyline";
        if (current.primitive.kind !== wanted) {
          return answer(
            `${current.id} is a ${current.primitive.kind === "polyline" ? "polygon" : current.primitive.kind}; give the same kind of ` +
              "geometry, or withdraw it and propose a new one. Nothing was changed.",
            { reason: "kind_mismatch" },
          );
        }
        let bbox = params.bbox;
        let polygon = params.polygon as Array<[number, number]> | undefined;
        if (params.space !== "object") {
          const resolved = await viewFrame(views, params.view_id, () => fetchObservation(base, focus, { signal: combined, fetch: doFetch }).then((o) => o.frame));
          if (typeof resolved === "string") return answer(`${resolved} Nothing was changed.`, { reason: "unknown_view" });
          const size = objectSize(viewer);
          if (bbox) {
            const [ax, ay] = viewPointToObject([bbox[0] ?? Number.NaN, bbox[1] ?? Number.NaN], resolved, size);
            const [bx, by] = viewPointToObject([bbox[2] ?? Number.NaN, bbox[3] ?? Number.NaN], resolved, size);
            bbox = [ax, ay, bx, by];
          }
          if (polygon) polygon = polygon.map((point) => viewPointToObject(point, resolved, size));
        }
        primitive = bbox ? bboxPrimitive(bbox) ?? undefined : { kind: "polyline", closed: true, points: polygon! };
        if (!primitive) return answer("That bbox is degenerate (zero width or height). Nothing was changed.", { reason: "degenerate_geometry" });
      }
      if (!primitive && !params.label) return answer("Nothing to change: give a new bbox, polygon or label.", { reason: "no_change" });

      const res = await doFetch(`${base}/annotations/${encodeURIComponent(current.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ base_seq: current.seq, ...(primitive ? { primitive } : {}), ...(params.label ? { label: params.label } : {}) }),
        signal: combined,
      });
      if (res.status === 409) return answer("It changed while you were working; look at it again before deciding.", { reason: "conflict" });
      if (!res.ok) {
        const text = (await res.text().catch(() => "")).replace(/\s+/gu, " ").slice(0, 200);
        return answer(`The revision was rejected (HTTP ${res.status}): ${text}. Nothing was changed.`, { reason: "rejected" });
      }
      const updated = ((await res.json()) as { annotation: Record<string, unknown> }).annotation;
      return answer(
        `Revised suggestion ${current.id}. It is still a suggestion awaiting the user; zoom in again if you want to confirm the fit.`,
        { annotation: updated, ...(params.note?.trim() ? { note: params.note.trim() } : {}) },
      );
    },
  };
}

/** 中文工具定义（SDD 20 §7.3）。 */
export const REVISE_ANNOTATION_ZH: ToolZh = {
  description: "修改或撤回你之前提出、用户尚未确认或拒绝的建议。放大复核发现框或轮廓有偏差时用它——修订同一条建议，而不是再提一条。你不能修改用户画的标注，也不能修改已确认或已拒绝的标注。",
  parameters: {
    annotation_id: "要修订的建议（你在本对话中提出的 id）。",
    action: "\"update\" 修改几何或标签；\"withdraw\" 撤回这条建议。",
    space: "新 bbox / polygon 的坐标系，与 propose_annotation 相同。",
    view_id: "space 为 \"view\" 时你所依据的视图；缺省为你最近一次查看的视图。",
    bbox: "新的矩形 [x0, y0, x1, y1]；只用于矩形建议。",
    polygon: "新的闭合轮廓 [[x, y], ...]；只用于多边形建议。",
    label: "新的标签（需要改时才给）。",
    note: "修订原因的简短说明，展示给用户。",
  },
};
