// 智能体工具产出 → 查看器状态的桥（退役 orchestration P3）。
// agent-runtime 的领域工具把结构化结果放进 `tool.end` 事件的 details（SDD 15 §9.5）；这里按工具名
// 分派并写回 session store。`run_task` 回流 Detection，`propose_annotation` 回流统一 Annotation。
// 只在结果对应的 image_id 仍是当前打开的图时应用——用户中途切图不被旧结果覆盖。
import type { Annotation, AnnotationPrimitive, Index, Measure, Primitive } from "../api/types";
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

function asIndex(value: unknown): Index | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const index: Index = {};
  for (const key of ["z", "t", "level"] as const) {
    if (v[key] === undefined || v[key] === null) continue;
    if (!Number.isInteger(v[key]) || (v[key] as number) < 0) return null;
    index[key] = v[key] as number;
  }
  return Object.keys(index).length <= 1 ? index : null;
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
  const index = asIndex(payload.index);
  if (!index) return null;
  const primitive = asAnnotationPrimitive(payload.primitive);
  if (!primitive) return null;
  return {
    id: payload.annotation_id,
    image_id: payload.image_id,
    index,
    primitive,
    label: payload.label,
    class_id: null,
    status: "suggested",
    source: "agent",
    seq: payload.seq as number,
  };
}

/** 工具结果的目标比对一律用唯一焦点（SDD 10 §7 规则 20），不按模态取活动 id。 */
function focusedId(): string | null {
  return useSession.getState().focus?.object_id ?? null;
}

/** run_task 结果的落点：缺省是前台查看器；后台会话传它自己的工作区快照（SDD 13 §7.7 规则 5）。 */
export interface TaskOutputSink {
  write: (
    imageId: string,
    output: { metrics: Record<string, Measure> | null; primitives: Primitive[]; modelVersion: string },
  ) => boolean;
}

const foregroundSink: TaskOutputSink = {
  write: (imageId, output) => {
    if (focusedId() !== imageId) return false;
    const s = useSession.getState();
    s.setMetrics(output.metrics);
    s.setPrimitives(output.primitives);
    s.setSource("agent");
    s.setModelVersion(output.modelVersion);
    // SDD 01 v1.4 §7-2：舞台已是右侧栏常驻底座，展开即可见，故此处不再切标签——
    // 旧的「切到舞台」会把用户正在用的浏览器列关掉，正是 D16/D17 要消除的抢占。折叠时不打扰。
    return true;
  },
};

/**
 * 处理一条 `tool.end` 事件（SDD 15 §9.5）；只认 `run_task` / `propose_annotation` + 非错误 + 合法 details。
 * 返回是否应用到了查看器或 ``sink``。标注建议是对象级共享数据，不论来自哪个会话，
 * 都按前台焦点决定是否显示（SDD 13 §7.7 规则 6）。
 */
export function applyToolExecutionEvent(event: unknown, sink: TaskOutputSink = foregroundSink): boolean {
  if (!event || typeof event !== "object") return false;
  const e = event as { tool_name?: unknown; is_error?: unknown; details?: unknown };
  if (typeof e.tool_name !== "string" || e.is_error !== false) return false;
  if (e.tool_name === PROPOSE_ANNOTATION_TOOL_NAME) {
    const annotation = asProposedAnnotation(e.details);
    if (!annotation || focusedId() !== annotation.image_id) return false;
    const session = useSession.getState();
    const focusedFrame = session.focus?.index.t;
    if (focusedFrame != null && annotation.index?.t !== focusedFrame) return false;
    const existing = session.annotations.find((item) => item.id === annotation.id);
    // SSE 重复送达不得把已经确认/驳回、seq 更高的状态退回 suggested。
    if (!existing || existing.seq < annotation.seq) session.upsertAnnotation(annotation);
    return true;
  }
  if (e.tool_name !== RUN_TASK_TOOL_NAME) return false;
  const details = asTaskOutputDetails(e.details);
  if (!details) return false;
  const model = details.output.provenance?.model_version;
  return sink.write(details.image_id, {
    metrics: details.output.metrics ?? null,
    primitives: details.output.primitives ?? [],
    modelVersion: model === undefined || model === null ? "" : String(model),
  });
}
