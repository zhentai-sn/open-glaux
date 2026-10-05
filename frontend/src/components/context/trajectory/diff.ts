// 请求头差异（SDD 21 §7.4 规则 1）：分段按 (kind, plugin, scope) 对齐，工具按名称对齐。
import type { RequestHeaderBody, TrajectorySegment } from "../../../agent/runtime/types";

export type DiffStatus = "added" | "removed" | "changed";

export interface SegmentChange {
  status: DiffStatus;
  segment: Pick<TrajectorySegment, "kind" | "plugin" | "scope">;
  /** 估算 token 变化：新增为新段的值，删除为负的旧段值。 */
  delta: number;
}

export interface HeaderDiff {
  segments: SegmentChange[];
  tools: { added: string[]; removed: string[]; changed: string[] };
}

function keyed(segments: TrajectorySegment[]): Map<string, TrajectorySegment> {
  const map = new Map<string, TrajectorySegment>();
  const seen = new Map<string, number>();
  for (const segment of segments) {
    const base = `${segment.kind}:${segment.plugin ?? ""}:${segment.scope ?? ""}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    map.set(n ? `${base}#${n}` : base, segment);
  }
  return map;
}

export function headerDiff(previous: RequestHeaderBody, next: RequestHeaderBody): HeaderDiff {
  const before = keyed(previous.segments);
  const after = keyed(next.segments);
  const segments: SegmentChange[] = [];
  for (const [key, segment] of after) {
    const old = before.get(key);
    if (!old) segments.push({ status: "added", segment, delta: segment.est_tokens });
    else if (old.text !== segment.text) segments.push({ status: "changed", segment, delta: segment.est_tokens - old.est_tokens });
  }
  for (const [key, segment] of before) {
    if (!after.has(key)) segments.push({ status: "removed", segment, delta: -segment.est_tokens });
  }
  const oldTools = new Map(previous.tools.map((tool) => [tool.name, tool]));
  const newTools = new Map(next.tools.map((tool) => [tool.name, tool]));
  const definition = (tool: RequestHeaderBody["tools"][number]) => JSON.stringify([tool.description, tool.parameters]);
  return {
    segments,
    tools: {
      added: next.tools.filter((tool) => !oldTools.has(tool.name)).map((tool) => tool.name),
      removed: previous.tools.filter((tool) => !newTools.has(tool.name)).map((tool) => tool.name),
      changed: next.tools.filter((tool) => oldTools.has(tool.name) && definition(oldTools.get(tool.name)!) !== definition(tool)).map((tool) => tool.name),
    },
  };
}

export function isEmptyDiff(diff: HeaderDiff): boolean {
  return !diff.segments.length && !diff.tools.added.length && !diff.tools.removed.length && !diff.tools.changed.length;
}
