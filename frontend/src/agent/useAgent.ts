import { useCallback } from "react";

import { ApiError, api } from "../api/client";
import { runCurrentTask } from "../data/actions";
import { useI18n } from "../i18n";
import { useSession } from "../store/session";

// 智能体交互的单一入口——ActivityBar(Run) 与 AgentPanel(Composer) 共用。
// scope 三态由后端 /interpret（真实 orchestrator）判定；in_scope 时统一走 runCurrentTask
// （按注册表取当前模态任务 → /task/run），产出泛型 taskrun 卡片。加任务/模态零改。
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
      const { activeImage, intentBackend, connection } = useSession.getState();
      const isVlm = intentBackend === "vlm";
      try {
        const r = await api.interpret(text, lang, {
          image_id: activeImage ?? undefined,
          backend: intentBackend,
          api_key: isVlm ? connection.apiKey || undefined : undefined,
          model: isVlm ? connection.model || undefined : undefined,
          provider: isVlm ? connection.provider : undefined,
          base_url: isVlm ? connection.baseUrl || undefined : undefined,
        });
        setLastScope(r.scope);
        if (r.scope === "chat") {
          // 闲聊：VLM 的自然回复在 reason 里，直接呈现（测量路径不受影响）
          pushAgent({ variant: "note", tone: "plain", text: r.reason });
          return;
        }
        if (r.scope === "out_of_scope") {
          pushAgent({ variant: "refuse", key: "refuse" });
          return;
        }
        if (r.scope === "ambiguous") {
          pushAgent({ variant: "clarify", key: "clarify" });
          return;
        }
        if (!activeImage) {
          pushAgent({ variant: "plain", key: "empty_editor" });
          return;
        }
        const { tasks, modality } = useSession.getState();
        const curTask = tasks.find((tk) => tk.modality === modality)?.task;
        const wantTask = r.spec?.task;
        // 意图任务与当前模态不符 → 提示切换（不静默跑错模态的数据）
        if (wantTask && curTask && wantTask !== curTask) {
          const wantLabel = tasks.find((tk) => tk.task === wantTask)?.label[lang] ?? wantTask;
          pushAgent({ variant: "note", tone: "plain", text: t("switch_task", { task: wantLabel }) });
          return;
        }
        const ok = await runCurrentTask(activeImage);
        const st = useSession.getState();
        if (ok && st.metrics && curTask) {
          pushAgent({ variant: "taskrun", task: curTask, model: st.modelVersion, metrics: st.metrics });
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

  // 首图载入并测量后，用真实结果种一段提议（不清空历史，见 R8）。泛型：按当前任务种卡。
  const seedFromCurrent = useCallback(() => {
    const st = useSession.getState();
    if (st.messages.length > 0 || !st.activeImage || !st.metrics) return;
    const tv = st.tasks.find((tk) => tk.modality === st.modality);
    if (!tv) return;
    pushUser(t("seed_task", { task: tv.label[lang] }));
    pushAgent({ variant: "taskrun", task: tv.task, model: st.modelVersion, metrics: st.metrics });
  }, [t, lang, pushUser, pushAgent]);

  return { run, seedFromCurrent };
}
