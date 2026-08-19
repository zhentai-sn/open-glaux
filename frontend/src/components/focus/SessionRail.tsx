import { useI18n } from "../../i18n";
import { useAgentSessions } from "../../store/agentSessions";
import { useSession } from "../../store/session";
import { SessionDrawer } from "../agent/SessionDrawer";
import { Icon } from "../Icon";
import { ICONS } from "../iconMap";

// 会话栏（SDD feats/01 §8）——SessionDrawer 的薄壳：默认收窄为竖条，点击展开。
// 展开态常驻挂载 SessionDrawer（不改其内部）；其头部 ✕（走 agentSessions.drawerOpen，
// 与本栏的 focusLayout.railOpen 无关）在 .focus-rail 作用域内由 CSS 隐藏，收起走本栏 « 按钮。
export function SessionRail() {
  const { t } = useI18n();
  const railOpen = useSession((s) => s.focusLayout.railOpen);
  const setFocusLayout = useSession((s) => s.setFocusLayout);
  const loading = useAgentSessions((s) => s.loading);
  const newSession = useAgentSessions((s) => s.newSession);

  return (
    <div className={"focus-rail" + (railOpen ? " open" : "")}>
      <div className="focus-rail-strip">
        <button
          className="focus-iconbtn"
          type="button"
          title={railOpen ? t("focus_rail_collapse") : t("agent_history")}
          aria-expanded={railOpen}
          onClick={() => setFocusLayout({ railOpen: !railOpen })}
        >
          <Icon icon={railOpen ? ICONS.chevronLeft : ICONS.menu} size="md" />
        </button>
        <button
          className="focus-iconbtn"
          type="button"
          title={t("agent_new_session")}
          disabled={loading}
          onClick={() => void newSession()}
        >
          <Icon icon={ICONS.plus} size="md" />
        </button>
      </div>
      {railOpen && (
        <div className="focus-rail-body">
          <SessionDrawer />
        </div>
      )}
    </div>
  );
}
