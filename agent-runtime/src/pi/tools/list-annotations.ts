/**
 * `list_annotations`（SDD 23 §7.5 规则 5）：读当前对象的标签目录、按标签汇总与标注列表。
 *
 * 只读（effect `read`）。汇总与标注面板用同一 backend 端点，回答「几处、总面积多少」时与面板一致；
 * 面积为各条之和，不做并集。
 */

import type { ToolZh } from "../../i18n/prompt-lang.js";
import { Type, type Static, type TextContent } from "@earendil-works/pi-ai";
import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";

import { backendBaseUrl } from "../../atlas/client.js";
import type { ViewerContext } from "../../contracts.js";
import { fetchCatalog } from "./label-catalog.js";

export const LIST_ANNOTATIONS_TOOL_NAME = "list_annotations";
export const ANNOTATIONS_LISTED_DETAILS_KIND = "glaux.annotations_listed";
/** 标注列表最多逐条列出的条数。 */
export const LIST_MAX = 200;

const ListAnnotationsParams = Type.Object({
  scope: Type.Optional(Type.String({
    enum: ["current", "all"],
    description: "\"current\" (default): the slice or frame shown in the viewer; \"all\": every slice or frame of the object.",
  })),
});

export type ListAnnotationsParams = Static<typeof ListAnnotationsParams>;

export interface AnnotationsListedDetails {
  kind: typeof ANNOTATIONS_LISTED_DETAILS_KIND;
  image_id: string;
  scope: "current" | "all";
  count?: number;
  reason?: string;
}

export interface ListAnnotationsToolOptions {
  viewer?: ViewerContext;
  backendBaseUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

interface SummaryGroup { kind: string; label_id: string | null; name: string; count: number; area: number; suggested: number }
interface Summary { unit: string; area_unit: string; groups: SummaryGroup[]; total: { count: number; area: number; suggested: number } }
interface Row {
  id: string;
  label: string;
  label_id: string | null;
  status: string;
  source: string;
  primitive: { kind: string; x0?: number; y0?: number; x1?: number; y1?: number; points?: number[][] };
  index?: Record<string, number>;
  measures?: { area: number; area_unit: string } | null;
}

const fmt = (n: number) => (Math.abs(n) >= 1000 ? Math.round(n).toString() : Number(n.toPrecision(4)).toString());

function extent(p: Row["primitive"]): string {
  if (p.kind === "bbox") return `[${fmt(p.x0!)}, ${fmt(p.y0!)}, ${fmt(p.x1!)}, ${fmt(p.y1!)}]`;
  if (p.kind === "polyline" && p.points?.length) {
    const xs = p.points.map((q) => q[0]!);
    const ys = p.points.map((q) => q[1]!);
    return `[${fmt(Math.min(...xs))}, ${fmt(Math.min(...ys))}, ${fmt(Math.max(...xs))}, ${fmt(Math.max(...ys))}]`;
  }
  return "—";
}

const shape = (kind: string) => (kind === "polyline" ? "polygon" : kind);

function groupName(g: SummaryGroup): string {
  if (g.kind === "unlabeled") return "(no label)";
  if (g.kind === "uncatalogued") return `"${g.name}" (not in catalog)`;
  return `"${g.name}"`;
}

export function createListAnnotationsTool(
  options: ListAnnotationsToolOptions = {},
): AgentHarnessTool<undefined, typeof ListAnnotationsParams, AnnotationsListedDetails> {
  const doFetch = options.fetch ?? fetch;
  const base = (options.backendBaseUrl ?? backendBaseUrl()).replace(/\/+$/u, "");
  const viewer = options.viewer ?? {};
  const timeoutMs = options.timeoutMs ?? 30_000;

  return {
    name: LIST_ANNOTATIONS_TOOL_NAME,
    label: "List annotations",
    description:
      "List the annotations on the image open in the viewer: the label catalog, per-label counts and areas, and each " +
      "annotation (id, label, status, who made it, shape, extent, area). Use it before proposing to learn the catalog's " +
      "label names, and to answer how many there are or how large they are. Counts and areas include drafts and confirmed " +
      "annotations; suggestions are counted separately; rejected ones are left out.",
    parameters: ListAnnotationsParams,
    async execute(_toolCallId, params, signal) {
      const abort = AbortSignal.timeout(timeoutMs);
      const combined = signal ? AbortSignal.any([signal, abort]) : abort;
      const scope = params.scope === "all" ? "all" : "current";
      const focus = viewer.focus;
      const text = (t: string, extra: Partial<AnnotationsListedDetails> = {}) => ({
        content: [{ type: "text", text: t } satisfies TextContent],
        details: { kind: ANNOTATIONS_LISTED_DETAILS_KIND, image_id: focus?.object_id ?? "", scope, ...extra } as AnnotationsListedDetails,
      });
      if (!focus) return text("No image is open in the viewer.", { reason: "no_image" });

      const imageId = focus.object_id;
      const qs = new URLSearchParams({ image_id: imageId });
      const third = (["z", "t", "level"] as const).find((axis) => axis !== "level" && focus.index[axis] != null);
      if (scope === "current" && third) {
        qs.set("index_from", String(focus.index[third]));
        qs.set("index_to", String(focus.index[third]));
      }
      const [catalog, summaryRes, listRes] = await Promise.all([
        fetchCatalog(base, imageId, doFetch, combined).catch(() => undefined),
        doFetch(`${base}/annotations/summary?${qs}`, { signal: combined }),
        doFetch(`${base}/annotations?${qs}`, { signal: combined }),
      ]);
      if (!summaryRes.ok || !listRes.ok) {
        return text(`Could not read the annotations (HTTP ${summaryRes.ok ? listRes.status : summaryRes.status}).`, { reason: "unavailable" });
      }
      const summary = (await summaryRes.json()) as Summary;
      const rows = ((await listRes.json()) as { annotations: Row[] }).annotations.filter((r) => r.status !== "rejected");

      const where = scope === "current" && third ? ` (${third} ${focus.index[third]})` : scope === "all" && third ? " (all slices/frames)" : "";
      const lines: string[] = [`Annotations on ${imageId}${where}. Areas are in ${summary.area_unit}; a group's area is the sum of its annotations (overlaps are not merged).`];
      if (catalog) {
        lines.push(catalog.length
          ? `Label catalog: ${catalog.map((l) => `"${l.name}"`).join(", ")}.`
          : "Label catalog: empty — the user has not defined labels for this image yet.");
      }
      if (!rows.length) {
        lines.push("There are no annotations.");
        return text(lines.join("\n"), { count: 0 });
      }
      lines.push("By label:");
      for (const g of summary.groups) {
        const pending = g.suggested ? `, ${g.suggested} suggestion${g.suggested > 1 ? "s" : ""} awaiting the user` : "";
        lines.push(`- ${groupName(g)}: ${g.count}, total area ${fmt(g.area)}${pending}`);
      }
      lines.push(`Total: ${summary.total.count}, area ${fmt(summary.total.area)}${summary.total.suggested ? `, plus ${summary.total.suggested} suggestions` : ""}.`);
      lines.push("Annotations (id | label | status | by | shape | extent [x0, y0, x1, y1] | area):");
      for (const r of rows.slice(0, LIST_MAX)) {
        const idx = Object.entries(r.index ?? {}).map(([k, v]) => ` ${k}=${v}`).join("");
        const label = r.label ? `"${r.label}"${r.label_id ? "" : " (not in catalog)"}` : "(no label)";
        const area = r.measures ? fmt(r.measures.area) : "—";
        lines.push(`- ${r.id} | ${label} | ${r.status} | ${r.source} | ${shape(r.primitive.kind)}${idx} | ${extent(r.primitive)} | ${area}`);
      }
      if (rows.length > LIST_MAX) lines.push(`… ${rows.length - LIST_MAX} more not listed (${rows.length} in total).`);
      return text(lines.join("\n"), { count: rows.length });
    },
  };
}

/** 中文工具定义（SDD 20 §7.3）。 */
export const LIST_ANNOTATIONS_ZH: ToolZh = {
  description:
    "列出查看器当前图像上的标注：标签目录、按标签的条数与面积、每条标注（id、标签、状态、来源、形状、范围、面积）。" +
    "提建议前用它了解目录里的标签名称；回答有几处、面积多大时用它。条数与面积计入草稿和已确认的标注，建议单独计数，已驳回的不计。",
  parameters: {
    scope: "\"current\"（缺省）：查看器当前显示的层或帧；\"all\"：该对象的全部层或帧。",
  },
};
