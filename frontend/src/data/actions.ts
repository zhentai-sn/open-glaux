// 真实数据编排（F5/F6/F8 + 多模态）——载数据集、切模态、选图、分割/检测 + 测量。
// 不推送智能体发言（静默载入）；智能体叙事在 useAgent 里叠加。
import { api } from "../api/client";
import type { Modality } from "../api/types";
import { useSession } from "../store/session";

/** 清空两模态的叠加/测量态（切图/切模态时）。 */
function clearOverlays(): void {
  const s = useSession.getState();
  s.setBoundaries(null);
  s.setMeasurement(null);
  s.setHcContour(null);
  s.setHcMeasurement(null);
}

/** 载入当前模态的数据集列表（Explorer）；若无选中图则选第一张。 */
export async function loadImages(): Promise<void> {
  const { modality } = useSession.getState();
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
  s.setImageMeta(null);
  clearOverlays();
  s.setTool("cursor");
  const imgs = await api.images(modality);
  useSession.getState().setImages(imgs);
  if (imgs.length) await selectImage(imgs[0].id);
}

/** IMT：用某模型分割 + 对齐口径测量。返回 pdm 字符串或 null。 */
export async function segmentAndMeasure(imageId: string, model: string): Promise<string | null> {
  const s = useSession.getState();
  const cf = s.imageMeta?.cf ?? undefined;
  s.setLoading(true);
  try {
    const seg = await api.segment(imageId, model);
    const res = await api.run({ task: "far_wall_cca_imt", image_id: imageId, cubs_cf: cf, method: model });
    useSession.getState().setBoundaries({
      li: seg.li,
      ma: seg.ma,
      source: "agent",
      modelVersion: seg.model_version,
    });
    useSession.getState().setMeasurement({
      mean_mm: res.mean_mm,
      max_mm: res.max_mm,
      pdm_mean_mm: res.pdm_mean_mm,
      n_columns: res.n_columns,
      vs_a1_um: res.vs_a1_um ?? null,
    });
    return res.pdm_mean_mm.toFixed(3);
  } catch {
    useSession.getState().setBoundaries(null);
    useSession.getState().setMeasurement(null);
    return null;
  } finally {
    useSession.getState().setLoading(false);
  }
}

/** HC：合成图 → 真椭圆检测 → 周长测量。返回 HC 字符串（mm）或 null。 */
export async function hcDetectAndMeasure(imageId: string): Promise<string | null> {
  const s = useSession.getState();
  const cf = s.imageMeta?.cf ?? undefined;
  s.setLoading(true);
  try {
    const r = await api.hcRun(imageId, cf);
    useSession.getState().setHcContour({
      points: r.contour,
      ellipse: r.ellipse,
      source: "agent",
      modelVersion: r.model_version,
    });
    useSession.getState().setHcMeasurement({
      hc_mm: r.hc_mm,
      bpd_mm: r.bpd_mm,
      ofd_mm: r.ofd_mm,
      area_mm2: r.area_mm2,
      vs_gt_mm: r.vs_gt_mm,
    });
    return r.hc_mm.toFixed(1);
  } catch {
    useSession.getState().setHcContour(null);
    useSession.getState().setHcMeasurement(null);
    return null;
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
  if (s.modality === "fetal_hc") await hcDetectAndMeasure(imageId);
  else await segmentAndMeasure(imageId, s.activeModel);
}

/** 重跑当前模态的活动模型/检测器（切模型 / Reset 用）。 */
export async function reRunActiveModel(): Promise<void> {
  const { activeImage, activeModel, modality } = useSession.getState();
  if (!activeImage) return;
  if (modality === "fetal_hc") await hcDetectAndMeasure(activeImage);
  else await segmentAndMeasure(activeImage, activeModel);
}
