/**
 * 标签目录的读取与提示（SDD 23 §7.5）。目录由用户维护，智能体只读：
 * 建议的标签不在目录中时，把目录名称告诉模型，由它改用目录名称；用户确认时再决定归类。
 */

export interface CatalogLabel {
  id: string;
  name: string;
  color: string;
  description?: string;
  count: number;
}

/** 结果文字里最多列出的目录名称数（§7.5 规则 2）。 */
export const CATALOG_HINT_MAX = 50;

export async function fetchCatalog(
  base: string,
  objectId: string,
  doFetch: typeof globalThis.fetch,
  signal?: AbortSignal,
): Promise<CatalogLabel[] | undefined> {
  const res = await doFetch(`${base}/labels?object_id=${encodeURIComponent(objectId)}`, signal ? { signal } : {});
  if (!res.ok) return undefined;
  return ((await res.json()) as { labels: CatalogLabel[] }).labels;
}

/** 标签未入目录时追加的说明；目录读不到时返回空串，不影响主结果。 */
export async function catalogHint(
  base: string,
  objectId: string,
  label: string,
  doFetch: typeof globalThis.fetch,
  signal?: AbortSignal,
): Promise<string> {
  const labels = await fetchCatalog(base, objectId, doFetch, signal).catch(() => undefined);
  if (!labels) return "";
  if (labels.length === 0) {
    return ` The label "${label}" is kept as text: this image has no label catalog yet, so the user will choose how to file it when confirming.`;
  }
  const names = labels.slice(0, CATALOG_HINT_MAX).map((l) => `"${l.name}"`).join(", ");
  const more = labels.length > CATALOG_HINT_MAX ? ` (and ${labels.length - CATALOG_HINT_MAX} more)` : "";
  return ` "${label}" is not in the label catalog for this image, so it is kept as text and the user will file it when confirming. ` +
    `Catalog labels: ${names}${more}. If one of them fits, revise the label to that exact name.`;
}
