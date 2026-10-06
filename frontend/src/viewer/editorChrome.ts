import { useMemo } from "react";

import type { Bilingual, ClassSpec, DataSource, Measure, ObjectMeta, Primitive, TaskView } from "../api/types";
import { taskViewFor } from "../data/actions";
import type { I18nKey } from "../i18n";
import { activeObject, useSession, type Source, type Tool, type Verification } from "../store/session";
import { ACTION_CATALOG, type ActionEntry } from "./actionCatalog";
import { frameAxisFor, type FrameAxis } from "./contract";
import { ALWAYS_TOOL, TOOL_CATALOG, type ToolEntry } from "./toolCatalog";

// 编辑区装配（SDD 04 §6.4、§7.5）——模式、视图、动作、读数四类元素的唯一装配入口。
// Workbench（ViewerChrome）与 Focus（StagePanel）只负责布局，不各自计算（规则 9）。

export interface ModeTools {
  task: TaskView | null;
  /** 模式工具启用集（查看器引擎据此激活工具）。 */
  capabilities: string[];
  /** 常驻 cursor + 启用的模式工具，按目录顺序。 */
  tools: ToolEntry[];
}

/**
 * 模式工具（§7.5 规则 2、3）：有任务只读 `TaskView.capabilities`，无任务读数据源的
 * `default_capabilities`，两者不合并（SDD 10 §9.4）。纯函数，供快捷键分发器直接调用。
 */
export function modeToolsFor(object: ObjectMeta | null, tasks: TaskView[], datasources: DataSource[]): ModeTools {
  if (!object) return { task: null, capabilities: [], tools: [] };
  const task = taskViewFor({ tasks }, object) ?? null;
  const capabilities = task?.capabilities ?? datasources.find((d) => d.id === object.source_id)?.default_capabilities ?? [];
  const enabled = new Set(capabilities);
  const tools = TOOL_CATALOG.filter((tool) => tool.id === ALWAYS_TOOL || enabled.has(tool.id));
  return { task, capabilities, tools };
}

export function useModeTools(): ModeTools {
  const object = useSession((s) => activeObject(s));
  const tasks = useSession((s) => s.tasks);
  const datasources = useSession((s) => s.datasources);
  return useMemo(() => modeToolsFor(object, tasks, datasources), [object, tasks, datasources]);
}

export interface EditorChrome extends ModeTools {
  object: ObjectMeta | null;
  tool: Tool;
  /** 当前模式的绘制提示。 */
  hint: I18nKey | null;
  /** 当前模式落库后会运行的任务（`on_commit` 派生，规则 1）；无则 null。 */
  commitTask: Bilingual | null;
  /** 模式选项：画笔参数段（仅画笔激活且启用时）。 */
  brushOptions: boolean;
  /** 模式选项：当前标签段（框、多边形、二维画笔——落成标注的工具，SDD 23 §4.1）。 */
  labelOptions: boolean;
  classes: ClassSpec[];
  /** 视图：窗宽窗位（kind=volume）与帧轴（axes 含 z / t），规则 4。 */
  voi: boolean;
  axis: FrameAxis;
  /** 动作：`TaskView.actions` 映射到目录；无任务为空（规则 5）。 */
  actions: ActionEntry[];
  /** 读数：注册表顺序的度量（仅 store 里存在的项）、来源、复现结果。 */
  readout: { metrics: Measure[]; source: Source; verification: Verification | null };
}

type VolMaskPrim = Extract<Primitive, { kind: "volume_mask" }>;

export function useEditorChrome(): EditorChrome {
  const modes = useModeTools();
  const object = useSession((s) => activeObject(s));
  const tool = useSession((s) => s.tool);
  const focus = useSession((s) => s.focus);
  const setIndex = useSession((s) => s.setIndex);
  const primitives = useSession((s) => s.primitives);
  const metrics = useSession((s) => s.metrics);
  const source = useSession((s) => s.source);
  const verification = useSession((s) => s.verification);

  return useMemo(() => {
    const { task, capabilities } = modes;
    const entry = modes.tools.find((candidate) => candidate.id === tool);
    const commits = entry && task?.on_commit?.[entry.id]?.action === "run_task";
    const volume = primitives.find((p): p is VolMaskPrim => p.kind === "volume_mask");
    return {
      ...modes,
      object,
      tool,
      hint: entry?.hint ?? null,
      commitTask: commits ? task.label : null,
      brushOptions: tool === "brush" && capabilities.includes("brush"),
      // CT 画笔走 /objects/{id}/edits，不是标注（SDD 04 D-13），不挂标签
      labelOptions: !!object && (tool === "bbox" || tool === "polygon" || (tool === "brush" && object.kind !== "volume")),
      classes: volume?.classes ?? [],
      voi: object?.kind === "volume",
      axis: frameAxisFor(object, focus, setIndex),
      actions: (task?.actions ?? []).map((id) => ACTION_CATALOG[id]).filter(Boolean),
      readout: {
        metrics: task && metrics ? task.metrics.map((m) => metrics[m.key]).filter((m): m is Measure => Boolean(m)) : [],
        source,
        verification,
      },
    };
  }, [modes, object, tool, focus, setIndex, primitives, metrics, source, verification]);
}
