import { useMemo } from "react";

import type { DataSource, ObjectMeta, TaskToolDef, TaskView } from "../api/types";
import { taskViewFor } from "../data/actions";
import { activeObject, useSession } from "../store/session";

const ALWAYS = new Set(["cursor", "reset"]);

// 无 TaskView 时只有显示元数据需要前端提供；能力清单仍以 /datasources 为准。
const GENERIC_TOOLS: TaskToolDef[] = [
  { id: "cursor", glyph: "▸", label: { en: "Select / Pan", zh: "选择 / 平移" }, key: "v" },
  { id: "bbox", glyph: "▭", label: { en: "Bounding box", zh: "框标注" }, key: "r" },
  { id: "polygon", glyph: "⬠", label: { en: "Polygon", zh: "多边形标注" }, key: "p" },
  { id: "brush", glyph: "✎", label: { en: "Brush", zh: "画笔" }, key: "b" },
  { id: "reset", glyph: "⟲", label: { en: "Reset", zh: "重置" } },
];

export interface TaskTools {
  task: TaskView | null;
  capabilities: string[];
  tools: TaskToolDef[];
  declaredTools: TaskToolDef[];
}

export function taskToolsFor(
  object: ObjectMeta | null,
  tasks: TaskView[],
  datasources: DataSource[],
): TaskTools {
  if (!object) return { task: null, capabilities: [], tools: [], declaredTools: [] };
  const task = taskViewFor({ tasks }, object) ?? null;
  const capabilities = task?.capabilities ?? datasources.find((d) => d.id === object.source_id)?.default_capabilities ?? [];
  const supported = new Set(capabilities);
  const declaredTools = task?.tools ?? GENERIC_TOOLS;
  const tools = declaredTools.filter((tool) => ALWAYS.has(tool.id) || supported.has(tool.id));
  return { task, capabilities, tools, declaredTools };
}

/** Workbench、Focus 与快捷键共用的工具装配入口。 */
export function useTaskTools(): TaskTools {
  const object = useSession((s) => activeObject(s));
  const tasks = useSession((s) => s.tasks);
  const datasources = useSession((s) => s.datasources);
  return useMemo(() => taskToolsFor(object, tasks, datasources), [object, tasks, datasources]);
}
