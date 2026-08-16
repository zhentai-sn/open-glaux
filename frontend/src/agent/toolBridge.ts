// 智能体工具产出 → 查看器状态的桥（退役 orchestration P3）。
// agent-runtime 的 `run_task` 工具在服务端调 backend /task/run，把完整 TaskOutput 放进
// tool_execution_end 事件的 result.details（kind = "glaux.task_output"）；这里把它写回 session
// store（metrics / primitives / source / modelVersion），与 data/actions.runCurrentTask 的写法一致。
// 只在结果对应的 image_id 仍是当前打开的图时应用——用户中途切图不被旧结果覆盖。
import type { Measure, Primitive } from "../api/types";
import { useSession } from "../store/session";

export const TASK_OUTPUT_DETAILS_KIND = "glaux.task_output";
export const RUN_TASK_TOOL_NAME = "run_task";

interface TaskOutputDetails {
  kind: typeof TASK_OUTPUT_DETAILS_KIND;
  task: string;
  image_id: string;
  output: {
    metrics?: Record<string, Measure>;
    primitives?: Primitive[];
    provenance?: Record<string, unknown>;
  };
}

function asTaskOutputDetails(value: unknown): TaskOutputDetails | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<TaskOutputDetails>;
  if (v.kind !== TASK_OUTPUT_DETAILS_KIND) return null;
  if (typeof v.task !== "string" || typeof v.image_id !== "string") return null;
  if (!v.output || typeof v.output !== "object") return null;
  return v as TaskOutputDetails;
}

/** 当前查看器"活动对象"的 id（图 / 体 / 切片按模态取一个）。 */
function activeTargetId(): string | null {
  const s = useSession.getState();
  if (s.modality === "ct_abdomen") return s.activeVolume;
  if (s.modality === "pathology") return s.activeSlide;
  return s.activeImage;
}

/**
 * 处理一条 pi 事件；只认 `tool_execution_end` + `run_task` + 非错误 + 合法 details。
 * 返回是否应用到了查看器。
 */
export function applyToolExecutionEvent(event: unknown): boolean {
  if (!event || typeof event !== "object") return false;
  const e = event as {
    type?: unknown;
    toolName?: unknown;
    isError?: unknown;
    result?: { details?: unknown };
  };
  if (e.type !== "tool_execution_end" || e.toolName !== RUN_TASK_TOOL_NAME) return false;
  if (e.isError) return false;
  const details = asTaskOutputDetails(e.result?.details);
  if (!details) return false;
  if (activeTargetId() !== details.image_id) return false; // 结果已过期（用户切图）

  const s = useSession.getState();
  s.setMetrics(details.output.metrics ?? null);
  s.setPrimitives(details.output.primitives ?? []);
  s.setSource("agent");
  const model = details.output.provenance?.model_version;
  s.setModelVersion(model === undefined || model === null ? "" : String(model));
  return true;
}
