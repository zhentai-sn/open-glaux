// 真实数据编排（F5/F6/F8 + 多模态）——载数据集、切模态、选图、统一驱动 /task/run。
// 单一泛型入口 runCurrentTask：按注册表取当前模态的任务 → api.taskRun → 设 metrics/primitives/
// source/modelVersion。加任务/模态零改（不再 segmentAndMeasure vs hcDetectAndMeasure 逐模态）。
// 不推送智能体发言（静默载入）；智能体对话走 agent-runtime 会话（store/agentSessions）。
import { api } from "../api/client";
import type { Modality, TaskType } from "../api/types";
import { TOOL_OPTIONS_DEFAULTS, useSession } from "../store/session";

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
  s.setAnnotations([]); // SDD 04：标注随对象切走，由查看器重新拉取
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
  if (modality === "pathology") {
    // P7：WSI 走 slides（activeSlide；不自动跑——核检测要先框 ROI）
    const sl = await api.slides();
    useSession.getState().setSlides(sl);
    const { activeSlide } = useSession.getState();
    if (!activeSlide && sl.length) await selectSlide(sl[0].id);
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
  s.setActiveSlide(null);
  s.setWsiRoi(null);
  s.setImageMeta(null);
  clearOverlays();
  s.setTool("cursor");
  // SDD 04：工具参数随模态复位（brush/voi 不跨模态泄漏）
  s.setToolOptions({
    brush: { ...TOOL_OPTIONS_DEFAULTS.brush },
    voi: { ...TOOL_OPTIONS_DEFAULTS.voi },
  });
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
  if (modality === "pathology") {
    // P7：WSI 模态独立分支——拉 slides + 选首 slide（不自动跑，等框 ROI）
    const sl = await api.slides();
    useSession.getState().setSlides(sl);
    if (sl.length) await selectSlide(sl[0].id);
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

/** P7：选 WSI slide——设元数据（含 mpp/dims）+ 清叠加/ROI。**不自动跑**（核检测要先框 ROI）。 */
export async function selectSlide(slideId: string): Promise<void> {
  const s = useSession.getState();
  const meta = s.slides.find((m) => m.id === slideId) ?? null;
  s.setActiveSlide(slideId);
  s.setImageMeta(meta);
  s.setWsiRoi(null);
  clearOverlays();
}

/** P7：WSI 核检测——按框选 ROI 跑 /task/run（roi_box）。成功返回 true。 */
export async function runWsiTask(
  slideId: string,
  roiBox: [number, number, number, number],
): Promise<boolean> {
  const s = useSession.getState();
  const task = currentTask();
  if (!task) return false;
  const method = s.activeModel || undefined;
  s.setWsiRoi(roiBox);
  s.setLoading(true);
  try {
    const res = await api.taskRun({ task, image_id: slideId, roi_box: roiBox, method });
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

/** 刷新「插件市场」相关注册表（能力 + 数据源 + 模型）——导入/删除数据源后调。 */
export async function reloadMarket(): Promise<void> {
  const [caps, ds, models] = await Promise.all([
    api.capabilities(),
    api.datasources(),
    api.models(),
  ]);
  useSession.getState().setCapabilities(caps);
  useSession.getState().setDatasources(ds);
  useSession.getState().setModels(models);
}

/** 导入一个文件夹为数据源 → 刷新市场；若导入的是当前模态，刷新数据列表。返回状态。 */
export async function importDataSource(path: string, modality: Modality): Promise<string> {
  const src = await api.importDatasource(path, modality);
  await reloadMarket();
  if (useSession.getState().modality === modality) await loadImages();
  return src.status;
}

/** 删除一个导入源 → 刷新市场（含当前模态数据列表，防删掉正用的源后列表悬空）。 */
export async function removeDataSource(id: string): Promise<void> {
  await api.removeDatasource(id);
  await reloadMarket();
  await loadImages();
}

/** 重跑当前模态的活动模型/检测器（切模型 / Reset 用）。 */
export async function reRunActiveModel(): Promise<void> {
  const s = useSession.getState();
  if (s.modality === "ct_abdomen") {
    if (!s.activeVolume) return;
    await runCurrentTask(s.activeVolume);
    return;
  }
  if (s.modality === "pathology") {
    // P7：重跑要有已框 ROI；否则无操作（提示在 WsiViewer 里）
    if (!s.activeSlide || !s.wsiRoi) return;
    await runWsiTask(s.activeSlide, s.wsiRoi);
    return;
  }
  if (!s.activeImage) return;
  await runCurrentTask(s.activeImage);
}
