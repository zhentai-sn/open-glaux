/**
 * `consult_atlas`——让参考智能体主动"翻图谱"（SDD 03 §6.3 / D-21）。
 *
 * SDD 03 原把图谱检索挂在 SDD 02 的 `locate_roi` 内部；`locate_roi` 连同整套标注工具尚未落地，
 * 图谱因此没有任何生产调用点（03 §15 已如实记为未达成）。D-21 改由本只读工具做宿主：
 * 检索链路（`selectExemplars`）原样复用，`locate_roi` 落地后把同一函数并进去即可，本工具可留可退。
 *
 * - 目标图取查看器当前打开的图（backend `GET /image/{id}`）；没开图时退化为纯文字检索，
 *   跳过 VLM 挑选步（`selectExemplars` 的 `target` 缺省路径）。
 * - 外发档位由 `egressFor(connection)` 判定：只有本机模型（base_url 解析为回环）才带上 local-only 案例。
 * - 结果 = 选中案例的**图像块 + 文字摘要**交给模型，`details` 走 `glaux.atlas_referenced`，
 *   前端 `AtlasRefCard` 渲染"参考图谱 N 条"卡片。
 * - 只在连接声明 `vision: true` 时注册（见 `harness-registry.ts`）——否则 pi-ai 会把图静默换成
 *   "image omitted"占位，模型以为自己看过图谱，比没有图谱更坏。
 * - 图谱对 agent 只读（SDD 03 D-1）：本工具只检索 + 记引用（`mark_referenced`），不写案例。
 */

import { randomUUID } from "node:crypto";

import { Type, type ImageContent, type Static, type TextContent } from "@earendil-works/pi-ai";
import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";

import { AtlasClient, backendBaseUrl, egressFor } from "../../atlas/client.js";
import { selectExemplars, type SelectedExemplar } from "../../atlas/select.js";
import type {
  AtlasReferencedPayload,
  ConnectionInput,
  ViewerContext,
} from "../../contracts.js";
import type { VisionRuntime } from "../vision.js";

export const CONSULT_ATLAS_TOOL_NAME = "consult_atlas";
export const ATLAS_REFERENCED_DETAILS_KIND = "glaux.atlas_referenced";

const ConsultAtlasParams = Type.Object({
  q: Type.Optional(
    Type.String({
      description:
        "Free-text query describing what you are looking for (finding, structure, modality). Matched against captions, tags and generated descriptions.",
    }),
  ),
  tags: Type.Optional(
    Type.Array(Type.String(), {
      description: "Tags to narrow the search, e.g. [\"TEM\", \"EDD\"]. Optional.",
    }),
  ),
  collection: Type.Optional(
    Type.String({
      description:
        "Collection path to search within, e.g. \"肾脏/膜性肾病\". Includes sub-collections. Optional.",
    }),
  ),
  k: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 3,
      description: "How many reference examples to bring back (1-3, default 3).",
    }),
  ),
});

export type ConsultAtlasParams = Static<typeof ConsultAtlasParams>;

export interface AtlasReferencedDetails {
  kind: typeof ATLAS_REFERENCED_DETAILS_KIND;
  payload: AtlasReferencedPayload;
}

export interface ConsultAtlasToolOptions {
  runtime: VisionRuntime;
  connection: Pick<ConnectionInput, "provider" | "base_url">;
  viewer?: ViewerContext;
  client?: AtlasClient;
  backendBaseUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

function describe(e: SelectedExemplar): string {
  const d = e.description as { summary?: unknown; findings?: unknown } | null;
  const summary = d && typeof d.summary === "string" ? d.summary : "";
  const parts = [
    `id: ${e.exemplar_id}`,
    e.caption ? `caption: ${e.caption}` : "",
    e.tags_raw.length ? `tags: ${e.tags_raw.join(", ")}` : "",
    summary ? `description: ${summary}` : "",
    e.notes ? `notes: ${e.notes}` : "",
  ].filter(Boolean);
  return parts.join(" — ");
}

/** 取查看器当前图作为对照目标（PNG）；失败返回 undefined，退化为纯文字检索。 */
async function fetchTarget(
  doFetch: typeof globalThis.fetch,
  base: string,
  imageId: string,
  signal: AbortSignal,
): Promise<{ data: string; mimeType: string } | undefined> {
  try {
    const res = await doFetch(`${base}/image/${encodeURIComponent(imageId)}`, { signal });
    if (!res.ok) return undefined;
    const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
    return { data: Buffer.from(await res.arrayBuffer()).toString("base64"), mimeType };
  } catch {
    return undefined;
  }
}

export function createConsultAtlasTool(
  options: ConsultAtlasToolOptions,
): AgentHarnessTool<undefined, typeof ConsultAtlasParams, AtlasReferencedDetails> {
  const doFetch = options.fetch ?? fetch;
  const base = (options.backendBaseUrl ?? backendBaseUrl()).replace(/\/+$/u, "");
  const viewer = options.viewer ?? {};
  const timeoutMs = options.timeoutMs ?? 60_000;
  const client =
    options.client ??
    new AtlasClient({ baseUrl: base, fetch: doFetch, ...(options.timeoutMs ? { timeoutMs } : {}) });

  return {
    name: CONSULT_ATLAS_TOOL_NAME,
    label: "Consult the atlas",
    description:
      "Look up curated reference examples in Glaux's Atlas — a human-curated, illustrated casebook of biomedical images " +
      "(textbook figures, paper images, annotated dataset samples), each with a caption, tags and a description. " +
      "Returns the most similar examples as images you can actually look at, compared against the image currently open in the viewer. " +
      "Use it before judging what a structure or finding looks like, when the user asks about a finding, or when you want precedent " +
      "instead of guessing from scratch. Returns nothing when the atlas has no matching case — say so plainly rather than inventing one.",
    parameters: ConsultAtlasParams,
    async execute(_toolCallId, params, signal) {
      const abort = AbortSignal.timeout(timeoutMs);
      const combined = signal ? AbortSignal.any([signal, abort]) : abort;
      const traceId = randomUUID();
      const k = params.k ?? 3;
      const egress = await egressFor(options.connection);
      const target = viewer.image_id
        ? await fetchTarget(doFetch, base, viewer.image_id, combined)
        : undefined;

      const tags = (params.tags ?? []).map((t) => t.trim()).filter(Boolean);
      const result = await selectExemplars(options.runtime, client, {
        ...(params.q?.trim() ? { q: params.q.trim() } : {}),
        ...(tags.length ? { tags } : {}),
        ...(params.collection?.trim() ? { collection: params.collection.trim() } : {}),
        egress,
        ...(target ? { target } : {}),
        traceId,
        k,
        signal: combined,
      });

      const details: AtlasReferencedDetails = {
        kind: ATLAS_REFERENCED_DETAILS_KIND,
        payload: result.event,
      };

      if (result.selected.length === 0) {
        const excluded = result.excluded_by_egress
          ? ` ${result.excluded_by_egress} local-only case(s) were withheld because this model is not running locally.`
          : "";
        return {
          content: [
            {
              type: "text",
              text: `The atlas has no matching case for this query.${excluded} Answer from your own knowledge and say that no reference case was available.`,
            } satisfies TextContent,
          ],
          details,
        };
      }

      // 记引用：只是溯源与"被引用过的案例不可硬删"的簿记，失败不该让整次查阅落空（SDD 03 D-13）。
      await client
        .markReferenced(result.selected.map((e) => e.exemplar_id), traceId, combined)
        .catch(() => undefined);

      const content: (TextContent | ImageContent)[] = [
        {
          type: "text",
          text:
            `Atlas: ${result.candidates.length} candidate(s), ${result.selected.length} reference case(s) selected` +
            (target ? " by visual similarity to the image open in the viewer" : " by search order (no image is open in the viewer)") +
            (result.excluded_by_egress
              ? `; ${result.excluded_by_egress} local-only case(s) withheld because this model is not running locally`
              : "") +
            ". These are curated reference examples, not the user's data — use them as precedent, and cite the ids you relied on.",
        },
      ];
      for (const e of result.selected) {
        content.push({ type: "text", text: describe(e) });
        content.push({ type: "image", data: e.crop_base64, mimeType: "image/png" });
      }

      return { content, details };
    },
  };
}
