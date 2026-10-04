import type { AgentItem } from "../../agent/runtime/types";
import { useI18n } from "../../i18n";
import { SOURCE_LABEL } from "./SkillsSection";

// 「子智能体」分区（SDD 19 §7.3 规则 4、SDD 18 §5.1）：只读列表，没有详情。

export function AgentsSection({ agents }: { agents: AgentItem[] }) {
  const { t } = useI18n();
  return (
    <section className="ctx-section" data-testid="agents-section">
      {!agents.length && <div className="res-empty">{t("res_empty")}</div>}
      {agents.map((item) => (
        <div key={`${item.source}-${item.name}`} className="res-item" title={item.path}>
          <div className="res-item-main static">
            <span className="res-item-name">{item.name}</span>
            <span className="res-item-desc">{item.description}</span>
            <span className="res-item-desc mono">
              {item.tools ? item.tools.join(", ") : t("res_agent_tools_all")} · {t("res_agent_max_turns", { n: item.max_turns })}
            </span>
          </div>
          <span className="res-badge">{t(SOURCE_LABEL[item.source])}</span>
          {item.overridden_by && <span className="res-badge">{t("res_overridden")}</span>}
        </div>
      ))}
    </section>
  );
}
