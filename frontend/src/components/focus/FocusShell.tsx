import { useState } from "react";

import { useConversation } from "../../agent/useConversation";
import { useI18n, type I18nKey } from "../../i18n";
import { useAgentSessions } from "../../store/agentSessions";
import { useSession } from "../../store/session";
import { AgentPanel } from "../AgentPanel";
import { Notice } from "../Notice";
import { OwlLogo } from "../OwlLogo";
import { FocusSidePanel } from "./FocusSidePanel";
import { FocusTopBar } from "./FocusTopBar";
import { SessionRail } from "./SessionRail";

// 空状态示例卡（纲领 G2：示例即教学；meta 行为任务/数据集标识，标识符不翻译）。
// 点击：连接可用即发送到参考智能体；未配模型则拉起 ⚙ 连接配置（不静默失败）。
const EXAMPLES: { title: I18nKey; desc: I18nKey; meta: I18nKey; prompt: I18nKey }[] = [
  { title: "focus_example_1_title", desc: "focus_example_1_desc", meta: "focus_example_1_meta", prompt: "focus_example_1_prompt" },
  { title: "focus_example_2_title", desc: "focus_example_2_desc", meta: "focus_example_2_meta", prompt: "focus_example_2_prompt" },
  { title: "focus_example_3_title", desc: "focus_example_3_desc", meta: "focus_example_3_meta", prompt: "focus_example_3_prompt" },
];

// 空状态布局按设计稿（mockup 视图 ①）：hero → 输入框卡片 → 示例卡，三段整组垂直居中。
function FocusHero() {
  const { t } = useI18n();
  return (
    <div className="focus-hero">
      <span className="focus-hero-logo" aria-hidden="true">
        <OwlLogo size={40} />
      </span>
      <h2>{t("focus_hero_title")}</h2>
      <p>{t("focus_hero_sub")}</p>
    </div>
  );
}

function FocusExampleCards({ onOpenConfig }: { onOpenConfig: () => void }) {
  const { t } = useI18n();
  const { send } = useConversation();
  const connection = useSession((s) => s.connection);
  const connected = useAgentSessions((s) => s.connected);
  const canSend = connected && Boolean(connection.model.trim());

  return (
    <div className="focus-cards">
      {EXAMPLES.map((ex) => (
        <button
          key={ex.title}
          className="focus-card"
          type="button"
          onClick={() => {
            if (canSend) void send(t(ex.prompt));
            else onOpenConfig();
          }}
        >
          <b>{t(ex.title)}</b>
          <span>{t(ex.desc)}</span>
          <span className="m">{t(ex.meta)}</span>
        </button>
      ))}
    </div>
  );
}

// Focus 外壳（SDD feats/01 §6.2/§8，v1.1）——纯布局壳：顶栏 + 会话栏 + 对话列 + 右侧栏（舞台/文件/图谱）。
// 领域状态全在共享 store，本组件零领域逻辑；对话列整体复用 AgentPanel（即 AgentConversation）。
export function FocusShell() {
  const [configOpen, setConfigOpen] = useState(false);
  const view = useAgentSessions((s) =>
    s.currentSessionId ? s.views[s.currentSessionId] : undefined,
  );
  const emptyConversation = !view || (view.messages?.length ?? 0) === 0;

  return (
    <div className="focus-shell shell-enter">
      <FocusTopBar configOpen={configOpen} onConfigToggle={setConfigOpen} />
      <div className="focus-body">
        <SessionRail />
        <div className={"focus-conversation" + (emptyConversation ? " empty" : "")}>
          {emptyConversation && <FocusHero />}
          <AgentPanel />
          {emptyConversation && <FocusExampleCards onOpenConfig={() => setConfigOpen(true)} />}
        </div>
        <FocusSidePanel />
      </div>
      <Notice />
    </div>
  );
}
