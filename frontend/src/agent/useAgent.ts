import { useCallback } from "react";

import { ApiError, api } from "../api/client";
import { segmentAndMeasure } from "../data/actions";
import { useI18n } from "../i18n";
import { useSession } from "../store/session";

// 智能体交互的单一入口——ActivityBar(Run) 与 AgentPanel(Composer) 共用。
// scope 三态由后端 /interpret（真实 orchestrator 规则后端）判定；in_scope 走真实
// 分割(/segment)+测量(/run) 四步，提议卡显真实对齐口径 IMT（F9）。
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
        // in_scope：真实四步（标定→分割→对齐口径测量）
        if (!activeImage) {
          pushAgent({ variant: "plain", key: "empty_editor" });
          return;
        }
        const { activeModel } = useSession.getState();
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
    [lang, pushUser, pushAgent, setLastScope],
  );

  // 首图载入并测量后，用真实结果种一段四步提议（不清空历史，见 R8）。
  const seedFromCurrent = useCallback(() => {
    const st = useSession.getState();
    if (st.messages.length > 0 || !st.measurement || !st.activeImage) return;
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
