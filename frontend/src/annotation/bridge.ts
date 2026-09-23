// annotationBridge（SDD 04 §6.1）——标注读写的**唯一**桥：
// CS3D / OpenSeadragon 原生叠加层事件 → Annotation 契约 → /annotations → store。
// 收敛三个查看器曾各自复制的 editSeqRef 序号守卫 + 失败回滚 + Notice 提示范式；
// 查看器一律经本模块写标注，不得自带回流逻辑（SDD 04 §15「范式仅一份」验收）。
import { ApiError, api } from "../api/client";
import type { Annotation, AnnotationCreated, AnnotationInput, TaskOutput } from "../api/types";
import { useSession } from "../store/session";

// 全局单调递增的编辑请求序号：await 之后仅当 mySeq === editSeq 才提交/回滚。
// 保证：后到的响应不会盖掉先到的；后到的回滚不会盖掉先到的成功。
let editSeq = 0;

/** 拉取某对象的标注（切图/切卷/切 slide 时调用）。 */
export async function loadAnnotations(imageId: string, z?: number | null): Promise<void> {
  const mySeq = ++editSeq;
  try {
    const { annotations } = await api.annotations.list(imageId, z);
    if (mySeq !== editSeq) return; // 已被更新的编辑/切换取代
    useSession.getState().setAnnotations(annotations);
  } catch {
    /* 标注拉取失败不阻塞查看器（底图照常） */
  }
}

/** on_commit 钩子产物回流（SDD 04 §7.3）：hook_result 走 Detection 通道，hook_error 提示。 */
function applyHook(resp: AnnotationCreated): void {
  const s = useSession.getState();
  if (resp.hook_result) {
    const out = resp.hook_result as TaskOutput;
    s.setMetrics(out.metrics);
    s.setPrimitives(out.primitives);
    s.setModelVersion(out.provenance?.model_version ? String(out.provenance.model_version) : s.modelVersion);
    s.setSource("agent");
  }
  if (resp.hook_error) s.notify("crit", `标注已保存，检测未触发：${resp.hook_error}`);
}

/** 创建标注——乐观先行渲染，失败/过期回滚。返回服务端标注（含 hook 产物）。 */
export async function createAnnotation(input: AnnotationInput): Promise<Annotation | null> {
  const s = useSession.getState();
  const mySeq = ++editSeq;
  const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // 乐观草稿（渲染立即跟上；服务端返回后换真 id）
  s.upsertAnnotation({
    id: tempId,
    image_id: input.image_id,
    z: input.z ?? null,
    primitive: input.primitive as Annotation["primitive"],
    label: input.label ?? "",
    class_id: input.class_id ?? null,
    status: "draft",
    source: "manual",
    seq: 0,
  });
  try {
    const resp = await api.annotations.create(input);
    if (mySeq !== editSeq) {
      s.removeAnnotation(tempId); // 已过期：清掉自己的草稿（服务端若已写入，loadAnnotations 会取回）
      return null;
    }
    s.removeAnnotation(tempId);
    s.upsertAnnotation(resp.annotation);
    applyHook(resp);
    return resp.annotation;
  } catch (err) {
    if (mySeq !== editSeq) {
      s.removeAnnotation(tempId); // 过期失败同样只清自己的草稿，不动后来者的状态
      return null;
    }
    s.removeAnnotation(tempId);
    const msg = err instanceof ApiError && err.status === 422 ? `标注被拒绝：${err.message}` : "标注未生效（后端失败），已丢弃本次绘制";
    s.notify("crit", msg);
    return null;
  }
}

/** 更新标注几何/标签（base_seq 乐观并发；409 → 提示 + 丢弃本次编辑）。 */
export async function patchAnnotation(
  id: string,
  baseSeq: number,
  patch: { primitive?: Annotation["primitive"]; mask_png_b64?: string; label?: string; class_id?: number | null },
): Promise<Annotation | null> {
  const s = useSession.getState();
  const mySeq = ++editSeq;
  try {
    const resp = await api.annotations.update(id, { base_seq: baseSeq, ...patch });
    if (mySeq !== editSeq) return null;
    s.upsertAnnotation(resp.annotation);
    return resp.annotation;
  } catch (err) {
    if (mySeq !== editSeq) return null;
    const conflict = err instanceof ApiError && err.status === 409;
    s.notify("crit", conflict ? "标注已被更新，请刷新后重试" : "标注更新未生效（后端失败），已丢弃本次编辑");
    return null;
  }
}

/**
 * 确认/驳回建议态标注（SDD 02）——agent 产出的 `suggested` 由人决定去留。
 *
 * 确认时后端会补派创建时跳过的 `on_commit`（建议态不该先产生 Detection 副作用），
 * 故这里与 `createAnnotation` 一样走 `applyHook` 回流；驳回不派钩子。
 * 驳回后标注仍在库里（`rejected`，留痕可审计），只是画布不再渲染。
 */
export async function resolveSuggestion(
  id: string,
  baseSeq: number,
  decision: "confirmed" | "rejected",
): Promise<Annotation | null> {
  const s = useSession.getState();
  const mySeq = ++editSeq;
  try {
    const resp = await api.annotations.update(id, { base_seq: baseSeq, status: decision });
    if (mySeq !== editSeq) return null;
    s.upsertAnnotation(resp.annotation);
    applyHook(resp as AnnotationCreated);
    return resp.annotation;
  } catch (err) {
    if (mySeq !== editSeq) return null;
    const conflict = err instanceof ApiError && err.status === 409;
    s.notify(
      "crit",
      conflict
        ? "该建议已被更新，请刷新后重试"
        : `建议${decision === "confirmed" ? "确认" : "驳回"}未生效（后端失败）`,
    );
    return null;
  }
}

/** 删除标注（base_seq 乐观并发；409 → 提示）。 */
export async function removeAnnotation(id: string, baseSeq: number): Promise<boolean> {
  const s = useSession.getState();
  const mySeq = ++editSeq;
  try {
    await api.annotations.remove(id, baseSeq);
    if (mySeq !== editSeq) return false;
    s.removeAnnotation(id);
    return true;
  } catch (err) {
    if (mySeq !== editSeq) return false;
    const conflict = err instanceof ApiError && err.status === 409;
    s.notify("crit", conflict ? "标注已被更新，无法删除——请刷新后重试" : "删除未生效（后端失败）");
    return false;
  }
}

/** 测试/复位用：重置全局序号（桥本身无状态泄漏）。 */
export function _resetEditSeqForTest(): void {
  editSeq = 0;
}
