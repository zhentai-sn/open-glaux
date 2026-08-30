// 最近使用（SDD 08 §9.4 / D-8）——只存浏览器本地，不落服务端、不进任何接口契约。
// 理由：最近使用是单机浏览习惯而非项目事实，落服务端会引入无谓的多端一致性问题。
import type { Modality } from "../api/types";

export const RECENT_KEY = "glaux.recent.v1";
export const RECENT_MAX = 10;

export interface RecentItem {
  modality: Modality;
  id: string;
  label: string;
  /** ISO 8601；仅用于排序与展示，不参与任何契约。 */
  at: string;
}

function isItem(v: unknown): v is RecentItem {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.modality === "string" &&
    typeof o.id === "string" &&
    typeof o.label === "string" &&
    typeof o.at === "string"
  );
}

/** 读；非法 JSON / 结构不符 / localStorage 不可用一律按空数组，不抛错（§9.4）。 */
export function readRecent(): RecentItem[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isItem).slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

export function writeRecent(items: RecentItem[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(items.slice(0, RECENT_MAX)));
  } catch {
    /* 隐私模式 / 配额满 → 丢持久化，不影响使用 */
  }
}

/**
 * 把一条置顶：同 (modality,id) 视为同一项，只更新 `at` 并前移，不追加重复（§10）。
 * `at` 由调用方传入而非在此取 now()，便于测试与保持纯函数。
 */
export function pushRecent(items: RecentItem[], next: RecentItem): RecentItem[] {
  const rest = items.filter((i) => !(i.modality === next.modality && i.id === next.id));
  return [next, ...rest].slice(0, RECENT_MAX);
}

/** 剔除当前列表里已不存在的对象（源被删/图被移走）——静默，不报错（§13）。 */
export function pruneRecent(
  items: RecentItem[],
  exists: (modality: Modality, id: string) => boolean,
): RecentItem[] {
  return items.filter((i) => exists(i.modality, i.id));
}
