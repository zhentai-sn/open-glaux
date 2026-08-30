// 智能体工具产出 → 查看器状态的桥（退役 orchestration P3）。
// agent-runtime 的领域工具把结构化结果放进 tool_execution_end.result.details；这里按工具名
// 分派并写回 session store。`run_task` 回流 Detection，`propose_annotation` 回流统一 Annotation。
// 只在结果对应的 image_id 仍是当前打开的图时应用——用户中途切图不被旧结果覆盖。
import type { Annotation, AnnotationPrimitive, Measure, Primitive } from "../api/types";
import { useSession } from "../store/session";

export const TASK_OUTPUT_DETAILS_KIND = "glaux.task_output";
export const RUN_TASK_TOOL_NAME = "run_task";
export const ANNOTATION_PROPOSED_DETAILS_KIND = "glaux.annotation_proposed";
export const PROPOSE_ANNOTATION_TOOL_NAME = "propose_annotation";

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

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Runtime details 是跨进程输入；只接收 propose_annotation 实际可能产出的两种矢量几何。 */
function asAnnotationPrimitive(value: unknown): AnnotationPrimitive | null {
  if (!value || typeof value !== "object") return null;
  const primitive = value as Record<string, unknown>;
  if (primitive.kind === "bbox") {
    const { x0, y0, x1, y1 } = primitive;
    if (!finite(x0) || !finite(y0) || !finite(x1) || !finite(y1)) return null;
    if (!(x1 > x0 && y1 > y0)) return null;
    return { kind: "bbox", x0, y0, x1, y1 };
  }
  if (primitive.kind === "polyline" && primitive.closed === true) {
    if (!Array.isArray(primitive.points) || primitive.points.length < 3) return null;
    const points = primitive.points.flatMap((point) =>
      Array.isArray(point) && point.length === 2 && point.every(finite)
        ? [[point[0], point[1]]]
        : [],
    );
    if (points.length !== primitive.points.length) return null;
    return { kind: "polyline", closed: true, points };
  }
  return null;
}

function asProposedAnnotation(value: unknown): Annotation | null {
  if (!value || typeof value !== "object") return null;
  const details = value as { kind?: unknown; payload?: unknown };
  if (details.kind !== ANNOTATION_PROPOSED_DETAILS_KIND) return null;
  if (!details.payload || typeof details.payload !== "object") return null;
  const payload = details.payload as Record<string, unknown>;
  if (typeof payload.annotation_id !== "string" || !payload.annotation_id) return null;
  if (typeof payload.image_id !== "string" || !payload.image_id) return null;
  if (typeof payload.label !== "string") return null;
  if (!Number.isInteger(payload.seq) || (payload.seq as number) < 1) return null;
  if (payload.z != null && (!Number.isInteger(payload.z) || (payload.z as number) < 0)) return null;
  const primitive = asAnnotationPrimitive(payload.primitive);
  if (!primitive) return null;
  return {
    id: payload.annotation_id,
    image_id: payload.image_id,
    z: payload.z == null ? null : (payload.z as number),
    primitive,
    label: payload.label,
    class_id: null,
    status: "suggested",
    source: "agent",
    seq: payload.seq as number,
  };
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
  if (e.type !== "tool_execution_end" || e.isError) return false;
  if (e.toolName === PROPOSE_ANNOTATION_TOOL_NAME) {
    const annotation = asProposedAnnotation(e.result?.details);
    if (!annotation || activeTargetId() !== annotation.image_id) return false;
    const session = useSession.getState();
    const existing = session.annotations.find((item) => item.id === annotation.id);
    // SSE 重复送达不得把已经确认/驳回、seq 更高的状态退回 suggested。
    if (!existing || existing.seq < annotation.seq) session.upsertAnnotation(annotation);
    return true;
  }
  if (e.toolName !== RUN_TASK_TOOL_NAME) return false;
  const details = asTaskOutputDetails(e.result?.details);
  if (!details || activeTargetId() !== details.image_id) return false;

  const s = useSession.getState();
  s.setMetrics(details.output.metrics ?? null);
  s.setPrimitives(details.output.primitives ?? []);
  s.setSource("agent");
  const model = details.output.provenance?.model_version;
  s.setModelVersion(model === undefined || model === null ? "" : String(model));
  // SDD 01 v1.1 §7-2：Focus 下结果写回查看器时，右侧栏若展开则切到舞台（折叠时不打扰）
  if (s.uiMode === "focus" && s.focusLayout.rightOpen && s.focusLayout.rightView !== "stage") {
    s.setFocusLayout({ rightView: "stage" });
  }
  return true;
}
