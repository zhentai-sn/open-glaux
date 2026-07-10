// 真实数据编排（F5/F6/F8 + 多模态）——载数据集、切模态、选图、统一驱动 /task/run。
// 单一泛型入口 runCurrentTask：按注册表取当前模态的任务 → api.taskRun → 设 metrics/primitives/
// source/modelVersion。加任务/模态零改（不再 segmentAndMeasure vs hcDetectAndMeasure 逐模态）。
// 不推送智能体发言（静默载入）；智能体叙事在 useAgent 里叠加。
import { api } from "../api/client";
import type { Modality, TaskType } from "../api/types";
import { useSession } from "../store/session";

/** 当前模态对应的任务类型（注册表真相源）；未就绪则 null。 */
function currentTask(): TaskType | null {
  const { tasks, modality } = useSession.getState();
  return tasks.find((t) => t.modality === modality)?.task ?? null;
}

/** 清空叠加/度量态（切图/切模态时）。 */
function clearOverlays(): void {
  const s = useSession.getState();
  s.setMetrics(null);
  s.setPrimitives([]);
  s.setSource("agent");
  s.setModelVersion("");
}

/** 载入当前模态的数据集列表（Explorer）；若无选中图则选第一张。 */
export async function loadImages(): Promise<void> {
  const { modality } = useSession.getState();
  if (modality === "ct_abdomen") {
    // P6：CT 模态走 volumes（不同端点 + activeVolume 而非 activeImage）
    const vols = await api.volumes();
    useSession.getState().setVolumes(vols);
    const { activeVolume } = useSession.getState();
    if (!activeVolume && vols.length) await selectVolume(vols[0].id);
    return;
  }
  const imgs = await api.images(modality);
  useSession.getState().setImages(imgs);
  const { activeImage } = useSession.getState();
  if (!activeImage && imgs.length) await selectImage(imgs[0].id);
}

/** 切换模态：换列表、清叠加、选首图并跑该模态的检测/分割 + 测量。 */
export async function switchModality(modality: Modality): Promise<void> {
  const s = useSession.getState();
  if (s.modality === modality) return;
  s.setModality(modality);
  s.setActiveImage(null);
  s.setActiveVolume(null);
  s.setImageMeta(null);
  clearOverlays();
  s.setTool("cursor");
  // 活动模型跟随模态：HC → CSM（真实）/ellipse-fit（合成），IMT → caroSegDeep。
  const pick = s.models.find((m) => m.modality === modality && m.active);
  if (pick) useSession.setState({ activeModel: pick.id });
  if (modality === "ct_abdomen") {
    // P6：CT 模态独立分支——拉 volumes + 选首 volume
    const vols = await api.volumes();
    useSession.getState().setVolumes(vols);
    if (vols.length) await selectVolume(vols[0].id);
    return;
  }
  const imgs = await api.images(modality);
  useSession.getState().setImages(imgs);
  if (imgs.length) await selectImage(imgs[0].id);
}

/** 泛型驱动：/task/run 当前模态的任务 → 设 metrics/primitives/source/modelVersion。成功返回 true。 */
export async function runCurrentTask(imageId: string): Promise<boolean> {
  const s = useSession.getState();
  const task = currentTask();
  if (!task) return false;
  const cf = s.imageMeta?.cf ?? undefined;
  const method = s.activeModel || undefined;
  s.setLoading(true);
  try {
    const res = await api.taskRun({ task, image_id: imageId, cubs_cf: cf, method });
    useSession.getState().setMetrics(res.metrics);
    useSession.getState().setPrimitives(res.primitives);
    useSession.getState().setSource("agent");
    useSession.getState().setModelVersion(String(res.provenance.model_version ?? method ?? ""));
    return Object.keys(res.metrics).length > 0;
  } catch {
    clearOverlays();
    return false;
  } finally {
    useSession.getState().setLoading(false);
  }
}

/** 选图：设元数据 + 载真图（画布自取 /image）+ 跑当前模态的检测/分割测量。 */
export async function selectImage(imageId: string): Promise<void> {
  const s = useSession.getState();
  const meta = s.images.find((m) => m.id === imageId) ?? null;
  s.setActiveImage(imageId);
  s.setImageMeta(meta);
  clearOverlays();
  await runCurrentTask(imageId);
}

/** P6：选 CT volume——设元数据（含 voxel_spacing_mm）+ 跑当前模态的 volume 任务。 */
export async function selectVolume(volumeId: string): Promise<void> {
  const s = useSession.getState();
  const meta = s.volumes.find((m) => m.id === volumeId) ?? null;
  s.setActiveVolume(volumeId);
  s.setImageMeta(meta);
  clearOverlays();
  await runCurrentTask(volumeId);
}

/** 重跑当前模态的活动模型/检测器（切模型 / Reset 用）。 */
export async function reRunActiveModel(): Promise<void> {
  const s = useSession.getState();
  if (s.modality === "ct_abdomen") {
    if (!s.activeVolume) return;
    await runCurrentTask(s.activeVolume);
    return;
  }
  if (!s.activeImage) return;
  await runCurrentTask(s.activeImage);
}
