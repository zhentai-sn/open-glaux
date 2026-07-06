import { useCallback } from "react";

import { ApiError, api } from "../api/client";
import { hcDetectAndMeasure, segmentAndMeasure } from "../data/actions";
import { useI18n } from "../i18n";
import { useSession } from "../store/session";

// 智能体交互的单一入口——ActivityBar(Run) 与 AgentPanel(Composer) 共用。
// scope 三态由后端 /interpret（真实 orchestrator）判定；in_scope 时按 spec.task 分派到
// 当前模态的真实链路：IMT 走 分割+对齐口径测量；HC 走 椭圆检测+Ramanujan 周长（F9 · 多模态）。
export function useAgent() {
  const { t, lang } = useI18n();
  const pushUser = useSession((s) => s.pushUser);
  const pushAgent = useSession((s) => s.pushAgent);
  const setLastScope = useSession((s) => s.setLastScope);

  const run = useCallback(
    async (nl: string) => {
      const text = nl.trim();
      if (!text) return;
      pushUser(text);
      const { activeImage, intentBackend, vlmKey, vlmModel } = useSession.getState();
      try {
        const r = await api.interpret(text, lang, {
          image_id: activeImage ?? undefined,
          backend: intentBackend,
          api_key: intentBackend === "vlm" ? vlmKey || undefined : undefined,
          model: intentBackend === "vlm" ? vlmModel || undefined : undefined,
        });
        setLastScope(r.scope);
        if (r.scope === "out_of_scope") {
          pushAgent({ variant: "refuse", key: "refuse" });
          return;
        }
        if (r.scope === "ambiguous") {
          pushAgent({ variant: "clarify", key: "clarify" });
          return;
        }
        // in_scope：按任务分派到当前模态的真实链路
        if (!activeImage) {
          pushAgent({ variant: "plain", key: "empty_editor" });
          return;
        }
        const { modality, activeModel } = useSession.getState();
        const wantHC = r.spec?.task === "fetal_hc";
        const isHC = modality === "fetal_hc";
        // 意图任务与当前模态不符 → 提示切换（不静默跑错模态的数据）
        if (wantHC !== isHC) {
          pushAgent({ variant: "note", tone: "plain", text: t(wantHC ? "switch_to_hc" : "switch_to_imt") });
          return;
        }
        if (isHC) {
          const hc = await hcDetectAndMeasure(activeImage);
          const st = useSession.getState();
          if (hc && st.hcMeasurement) {
            pushAgent({
              variant: "hcrun",
              model: st.hcContour?.modelVersion ?? "ellipse-fit",
              hc,
              bpd: st.hcMeasurement.bpd_mm.toFixed(1),
              ofd: st.hcMeasurement.ofd_mm.toFixed(1),
              vsGt: st.hcMeasurement.vs_gt_mm,
            });
          } else {
            pushAgent({ variant: "plain", key: "empty_editor" });
          }
          return;
        }
        const pdm = await segmentAndMeasure(activeImage, activeModel);
        const st = useSession.getState();
        if (pdm && st.measurement) {
          pushAgent({
            variant: "run",
            model: st.boundaries?.modelVersion ?? activeModel,
            imt: pdm,
            max: st.measurement.max_mm.toFixed(3),
            cols: st.measurement.n_columns,
            vsA1: st.measurement.vs_a1_um,
          });
        } else {
          pushAgent({ variant: "plain", key: "empty_editor" });
        }
      } catch (e) {
        // 意图后端不可用（如 VLM 缺密钥/鉴权失败）→ 显式呈现，不静默
        const detail = e instanceof ApiError ? e.message : String(e);
        pushAgent({ variant: "note", tone: "crit", text: `⚠ ${detail}` });
      }
    },
    [lang, t, pushUser, pushAgent, setLastScope],
  );

  // 首图载入并测量后，用真实结果种一段提议（不清空历史，见 R8）。按模态种 IMT/HC 卡。
  const seedFromCurrent = useCallback(() => {
    const st = useSession.getState();
    if (st.messages.length > 0 || !st.activeImage) return;
    if (st.modality === "fetal_hc") {
      if (!st.hcMeasurement) return;
      pushUser(t("seed_hc"));
      pushAgent({
        variant: "hcrun",
        model: st.hcContour?.modelVersion ?? "ellipse-fit",
        hc: st.hcMeasurement.hc_mm.toFixed(1),
        bpd: st.hcMeasurement.bpd_mm.toFixed(1),
        ofd: st.hcMeasurement.ofd_mm.toFixed(1),
        vsGt: st.hcMeasurement.vs_gt_mm,
      });
      return;
    }
    if (!st.measurement) return;
    pushUser(t("seed"));
    pushAgent({
      variant: "run",
      model: st.boundaries?.modelVersion ?? st.activeModel,
      imt: st.measurement.pdm_mean_mm.toFixed(3),
      max: st.measurement.max_mm.toFixed(3),
      cols: st.measurement.n_columns,
      vsA1: st.measurement.vs_a1_um,
    });
  }, [t, pushUser, pushAgent]);

  return { run, seedFromCurrent };
}
