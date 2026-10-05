import type { Session, SessionTreeEntry } from "@earendil-works/pi-agent-core";

/**
 * 从叶子沿父链到根的完整路径（SDD 21 §7.2 规则 1）。
 * pi 的 `getBranch()` 在最近一次压缩的保留起点处截断，只够构建模型上下文；轨迹要看到压缩前的历史。
 */
export async function fullBranch(session: Session): Promise<SessionTreeEntry[]> {
  const leafId = await session.getLeafId();
  if (!leafId) return [];
  const byId = new Map((await session.getEntries()).map((entry) => [entry.id, entry]));
  const path: SessionTreeEntry[] = [];
  for (let current = byId.get(leafId); current; current = current.parentId ? byId.get(current.parentId) : undefined) {
    path.unshift(current);
  }
  return path;
}
