// 最近使用（SDD 08 §9.4 / D-8、SDD 10 §9.5）——只存浏览器本地，不落服务端、不进任何接口契约。
// 理由：最近使用是单机浏览习惯而非项目事实，落服务端会引入无谓的多端一致性问题。
import type { ObjectKind } from "../api/types";

export const RECENT_KEY = "glaux.recent.v2";
/** v1 键：首次读取时单向迁移到 v2 后删除。 */
export const RECENT_KEY_V1 = "glaux.recent.v1";
export const RECENT_MAX = 10;

export interface RecentItem {
  modality: string;
  kind: ObjectKind;
  id: string;
  label: string;
  /** ISO 8601；仅用于排序与展示，不参与任何契约。 */
  at: string;
}

const KINDS: readonly ObjectKind[] = ["image", "volume", "slide", "video"];

/**
 * v1 记录只可能来自 v1 时代的五个模态，故迁移用一张冻结的对照表推断 kind——它描述的是历史数据，
 * 不是模态注册表；新模态的记录一律以 v2 形态写入，不经这里。推断不出的条目丢弃。
 */
const V1_KIND: Readonly<Record<string, ObjectKind>> = {
  carotid_imt: "image",
  fetal_hc: "image",
  natural_image: "image",
  ct_abdomen: "volume",
  pathology: "slide",
};

function isItem(v: unknown): v is RecentItem {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.modality === "string" &&
    KINDS.includes(o.kind as ObjectKind) &&
    typeof o.id === "string" &&
    typeof o.label === "string" &&
    typeof o.at === "string"
  );
}

function parseList(raw: string | null): unknown[] {
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

/** v1 → v2：逐条按 modality 补 kind，推断不出或结构不符的条目丢弃。纯函数。 */
export function migrateV1(items: unknown[]): RecentItem[] {
  const out: RecentItem[] = [];
  for (const v of items) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const kind = typeof o.modality === "string" ? V1_KIND[o.modality] : undefined;
    const item = { ...o, kind };
    if (kind && isItem(item)) out.push(item);
  }
  return out.slice(0, RECENT_MAX);
}

/**
 * 读；v2 键存在时不再读 v1。v2 缺失而 v1 存在 → 迁移、写 v2、删 v1（只做一次）。
 * 非法 JSON / 结构不符 / localStorage 不可用一律按空数组，不抛错（§9.4）。
 */
export function readRecent(): RecentItem[] {
  try {
    const v2 = localStorage.getItem(RECENT_KEY);
    if (v2 !== null) return parseList(v2).filter(isItem).slice(0, RECENT_MAX);
    const v1 = localStorage.getItem(RECENT_KEY_V1);
    if (v1 === null) return [];
    let migrated: RecentItem[] = [];
    try {
      migrated = migrateV1(parseList(v1));
    } catch {
      migrated = []; // v1 损坏：迁移为空，仍然完成迁移、删掉旧键
    }
    writeRecent(migrated);
    localStorage.removeItem(RECENT_KEY_V1);
    return migrated;
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
  exists: (modality: string, id: string) => boolean,
): RecentItem[] {
  return items.filter((i) => exists(i.modality, i.id));
}
