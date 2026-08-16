/**
 * 两步 VLM 的"翻图谱"步（SDD 03 §6.3 / D-11）：检索候选 ≤ 10 → VLM 从候选挑 1–3 张。
 *
 * 供 SDD 02 `locate_roi` 调用（第二步"带选中案例定位"由 `locate_roi` 完成）；本模块自身
 * 不发任何会话事件，只返回结构化结果 + `atlas.referenced` 事件 payload 的构造函数。
 *
 * - 候选 0 → 直接返回（调用方走无先验路径）。
 * - 候选 ≤ `skipSelectionUpTo`（默认 3）→ 跳过挑选，全部选中。
 * - `excluded_by_egress`：当外发档位为 `shareable` 时，另以 `egress=any` 检索一次求差
 *   （只比较 id，不取图）——用于卡片提示"N 条本地案例因外发限制未使用"。
 */

import type { AtlasReferencedPayload } from "../contracts.js";
import { chooseAmongImages, type ImageInput, type VisionRuntime } from "../pi/vision.js";
import type { AtlasClient, AtlasExemplar, Egress } from "./client.js";

export interface SelectExemplarsInput {
  tags?: string[];
  q?: string;
  egress: Egress;
  target: ImageInput;
  traceId: string;
  k?: number;
  limit?: number;
  skipSelectionUpTo?: number;
  signal?: AbortSignal;
}

export interface SelectedExemplar extends AtlasExemplar {
  crop_base64: string;
}

export interface SelectExemplarsResult {
  candidates: AtlasExemplar[];
  selected: SelectedExemplar[];
  excluded_by_egress: number;
  /** 直接可作 `atlas.referenced` 事件 payload */
  event: AtlasReferencedPayload;
}

function summaryOf(e: AtlasExemplar): string {
  const d = e.description as { summary?: unknown } | null;
  const s = d && typeof d.summary === "string" ? d.summary : "";
  return [e.caption ?? "", s].filter(Boolean).join(" · ").slice(0, 200);
}

export async function selectExemplars(
  rt: VisionRuntime,
  client: AtlasClient,
  input: SelectExemplarsInput,
): Promise<SelectExemplarsResult> {
  const limit = input.limit ?? 10;
  const candidates = await client.search({
    ...(input.tags ? { tags: input.tags } : {}),
    ...(input.q ? { q: input.q } : {}),
    egress: input.egress,
    limit,
    ...(input.signal ? { signal: input.signal } : {}),
  });

  let excluded = 0;
  if (input.egress === "shareable") {
    try {
      const all = await client.search({
        ...(input.tags ? { tags: input.tags } : {}),
        ...(input.q ? { q: input.q } : {}),
        egress: "any",
        limit,
        ...(input.signal ? { signal: input.signal } : {}),
      });
      const have = new Set(candidates.map((c) => c.exemplar_id));
      excluded = all.filter((c) => !have.has(c.exemplar_id)).length;
    } catch {
      excluded = 0; // 只是提示信息，失败不影响主流程
    }
  }

  const build = (selected: SelectedExemplar[]): SelectExemplarsResult => ({
    candidates,
    selected,
    excluded_by_egress: excluded,
    event: {
      trace_id: input.traceId,
      candidate_ids: candidates.map((c) => c.exemplar_id),
      selected_ids: selected.map((c) => c.exemplar_id),
      excluded_by_egress: excluded,
      snapshots: selected.map((c) => ({
        exemplar_id: c.exemplar_id,
        caption: c.caption ?? "",
        tags: c.tags_raw,
      })),
    },
  });

  if (candidates.length === 0) return build([]);

  const withCrops: SelectedExemplar[] = [];
  for (const c of candidates) {
    withCrops.push({ ...c, crop_base64: await client.fetchCropBase64(c.exemplar_id, input.signal) });
  }

  const skipUpTo = input.skipSelectionUpTo ?? 3;
  if (withCrops.length <= skipUpTo) return build(withCrops);

  const chosen = await chooseAmongImages(rt, {
    target: input.target,
    candidates: withCrops.map((c) => ({
      id: c.exemplar_id,
      image: { data: c.crop_base64, mimeType: "image/png" },
      summary: summaryOf(c),
    })),
    k: input.k ?? 3,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const byId = new Map(withCrops.map((c) => [c.exemplar_id, c]));
  const selected = chosen.map((id) => byId.get(id)).filter((c): c is SelectedExemplar => Boolean(c));
  // 模型一张都没选中合法 id 时退化为按检索序取前 k（不让整条链因挑选失败而空手）
  return build(selected.length ? selected : withCrops.slice(0, input.k ?? 3));
}
