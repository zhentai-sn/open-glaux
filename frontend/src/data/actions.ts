// 真实数据编排（F5/F6/F8）——载数据集、选图、按模型分割+测量。
// 不推送智能体发言（静默载入）；智能体四步叙事在 useAgent 里叠加。
import { api } from "../api/client";
import { useSession } from "../store/session";

/** 载入数据集列表（Explorer）；若无选中图则选第一张。 */
export async function loadImages(): Promise<void> {
  const imgs = await api.images();
  useSession.getState().setImages(imgs);
  const { activeImage } = useSession.getState();
  if (!activeImage && imgs.length) await selectImage(imgs[0].id);
}

/** 用某模型分割 + 对齐口径测量，更新画布边界与测量面板。返回 pdm 字符串或 null。 */
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

/** 选图：设元数据 + 载真图（画布自取 /image）+ 用当前模型分割测量。 */
export async function selectImage(imageId: string): Promise<void> {
  const s = useSession.getState();
  const meta = s.images.find((m) => m.id === imageId) ?? null;
  s.setActiveImage(imageId);
  s.setImageMeta(meta);
  s.setBoundaries(null);
  s.setMeasurement(null);
  await segmentAndMeasure(imageId, s.activeModel);
}

/** 切换分割模型后，对当前图重跑分割测量（R4-P1）。 */
export async function reRunActiveModel(): Promise<void> {
  const { activeImage, activeModel } = useSession.getState();
  if (activeImage) await segmentAndMeasure(activeImage, activeModel);
}
