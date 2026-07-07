// 真实数据编排（F5/F6/F8 + 多模态）——载数据集、切模态、选图、统一驱动 /task/run。
// 数据流统一到 api.taskRun（多模态通吃）：设泛型 metrics（面板真相源）+ 由 primitives/metrics
// 派生强类型 boundaries/measurement/hcContour/hcMeasurement（画布/agent/状态栏沿用，零改）。
// 不推送智能体发言（静默载入）；智能体叙事在 useAgent 里叠加。
import { api } from "../api/client";
import type { Modality, Primitive } from "../api/types";
import { useSession } from "../store/session";

type Poly = Extract<Primitive, { kind: "polyline" }>;
type Ell = Extract<Primitive, { kind: "ellipse" }>;

/** 清空两模态的叠加/测量态（切图/切模态时）。 */
function clearOverlays(): void {
  const s = useSession.getState();
  s.setMetrics(null);
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
  // 活动模型跟随模态：HC → CSM（真实）/ellipse-fit（合成），IMT → caroSegDeep。
  const pick = s.models.find((m) => m.modality === modality && m.active);
  if (pick) useSession.setState({ activeModel: pick.id });
  const imgs = await api.images(modality);
  useSession.getState().setImages(imgs);
  if (imgs.length) await selectImage(imgs[0].id);
}

/** IMT：统一驱动 /task/run → 设 metrics + 派生 boundaries/measurement。返回 pdm 字符串或 null。 */
export async function segmentAndMeasure(imageId: string, model: string): Promise<string | null> {
  const s = useSession.getState();
  const cf = s.imageMeta?.cf ?? undefined;
  s.setLoading(true);
  try {
    const res = await api.taskRun({ task: "far_wall_cca_imt", image_id: imageId, cubs_cf: cf, method: model });
    const li = res.primitives.find((p): p is Poly => p.kind === "polyline" && p.role === "LI");
    const ma = res.primitives.find((p): p is Poly => p.kind === "polyline" && p.role === "MA");
    const m = res.metrics;
    useSession.getState().setMetrics(m);
    if (li && ma) {
      useSession.getState().setBoundaries({
        li: li.points,
        ma: ma.points,
        source: "agent",
        modelVersion: String(res.provenance.model_version ?? model),
      });
    }
    useSession.getState().setMeasurement({
      mean_mm: m.IMT_mean?.value ?? 0,
      max_mm: m.IMT_max?.value ?? 0,
      pdm_mean_mm: m.IMT_pdm?.value ?? 0,
      n_columns: li ? li.points.length : 0,
      vs_a1_um: m.vs_A1?.value ?? null,
    });
    return (m.IMT_pdm?.value ?? 0).toFixed(3);
  } catch {
    clearOverlays();
    return null;
  } finally {
    useSession.getState().setLoading(false);
  }
}

/** HC：统一驱动 /task/run → 设 metrics + 派生 hcContour/hcMeasurement。返回 HC 字符串或 null。 */
export async function hcDetectAndMeasure(imageId: string): Promise<string | null> {
  const s = useSession.getState();
  const cf = s.imageMeta?.cf ?? undefined;
  s.setLoading(true);
  try {
    const res = await api.taskRun({ task: "fetal_hc", image_id: imageId, cubs_cf: cf });
    const ell = res.primitives.find((p): p is Ell => p.kind === "ellipse");
    const m = res.metrics;
    useSession.getState().setMetrics(m);
    if (ell) {
      useSession.getState().setHcContour({
        points: [],
        ellipse: { cx: ell.cx, cy: ell.cy, a: ell.a, b: ell.b, theta: ell.theta },
        source: "agent",
        modelVersion: String(res.provenance.model_version ?? ""),
      });
    }
    useSession.getState().setHcMeasurement({
      hc_mm: m.HC?.value ?? 0,
      bpd_mm: m.BPD?.value ?? 0,
      ofd_mm: m.OFD?.value ?? 0,
      area_mm2: m.area?.value ?? 0,
      vs_gt_mm: m.vs_GT?.value ?? null,
    });
    return (m.HC?.value ?? 0).toFixed(1);
  } catch {
    clearOverlays();
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
