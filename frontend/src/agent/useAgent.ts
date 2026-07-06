import { useCallback } from "react";

import { api } from "../api/client";
import { useI18n } from "../i18n";
import { useSession } from "../store/session";

// 智能体交互的单一入口——ActivityBar(Run) 与 AgentPanel(Composer) 共用。
// M0：scope 三态由后端 /interpret（镜像 orchestrator 规则分类）判定；呈现走本地字典。
// M1（F9）：in_scope 继续接 /run → /segment → /measure 的四步真跑批。
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
      const { activeImage, activeModel, imt } = useSession.getState();
      try {
        const r = await api.interpret(text, lang, { image_id: activeImage ?? undefined });
        setLastScope(r.scope);
        if (r.scope === "out_of_scope") {
          pushAgent({ variant: "refuse", key: "refuse" });
        } else if (r.scope === "ambiguous") {
          pushAgent({ variant: "clarify", key: "clarify" });
        } else {
          pushAgent({ variant: "run", model: activeModel, imt });
        }
      } catch {
        pushAgent({ variant: "plain", key: "empty_editor" }); // 后端不可达时的兜底占位（M1 换错误态）
      }
    },
    [lang, pushUser, pushAgent, setLastScope],
  );

  const seed = useCallback(() => {
    // 初次进入演示种子：一条用户指令 + 一次 in_scope 四步提议（不清空历史，见 R8）。
    if (useSession.getState().messages.length > 0) return;
    void run(t("seed"));
  }, [run, t]);

  return { run, seed };
}
