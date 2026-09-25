import { CHAT_EDITION } from "../../edition";
import { useI18n, type I18nKey } from "../../i18n";
import { useAgentSessions } from "../../store/agentSessions";
import { useSession, type FocusLayout } from "../../store/session";
import { SessionDrawer } from "../agent/SessionDrawer";
import { Icon } from "../Icon";
import { ICONS, TAB_ICON } from "../iconMap";

// 右侧栏入口的按下态与点击语义（SDD feats/01 v1.6 D22，活动栏式）：
// - 舞台：未按下 → 展开纯舞台；舞台 + 文件列 → 收掉文件列；只剩舞台 → 收起右侧栏。
// - 文件：未开 → 展开舞台并打开文件列；已开 → 关掉文件列。
// - 图谱：未开 → 右侧换成图谱；已开 → 收起右侧栏。
type EntryId = "stage" | "files" | "atlas";
const WORKSPACE_ENTRIES: {
  id: EntryId;
  label: I18nKey;
  onTitle: I18nKey;
  pressed: (l: FocusLayout) => boolean;
  next: (l: FocusLayout) => Partial<FocusLayout>;
}[] = [
  {
    id: "stage",
    label: "focus_tab_stage",
    onTitle: "focus_side_collapse",
    pressed: (l) => l.rightOpen && l.sideView === "stage",
    next: (l) =>
      !l.rightOpen || l.sideView !== "stage"
        ? { rightOpen: true, sideView: "stage", browserView: null } // 只要舞台；窄屏降级态下留着文件列会盖住舞台
        : l.browserView
          ? { browserView: null }
          : { rightOpen: false },
  },
  {
    id: "files",
    label: "focus_tab_files",
    onTitle: "focus_browser_close",
    pressed: (l) => l.rightOpen && l.sideView === "stage" && l.browserView === "files",
    next: (l) =>
      l.rightOpen && l.sideView === "stage" && l.browserView === "files"
        ? { browserView: null }
        : { rightOpen: true, sideView: "stage", browserView: "files" },
  },
  {
    id: "atlas",
    label: "focus_tab_atlas",
    onTitle: "focus_side_collapse",
    pressed: (l) => l.rightOpen && l.sideView === "atlas",
    next: (l) => (l.rightOpen && l.sideView === "atlas" ? { rightOpen: false } : { rightOpen: true, sideView: "atlas" }),
  },
];

// 会话栏（SDD feats/01 §8）——SessionDrawer 的薄壳：默认收窄为竖条，点击展开。
// 竖条同时承载一级入口：会话（☰ / ＋）与右侧栏的舞台 / 文件 / 图谱。
// 展开态常驻挂载 SessionDrawer（不改其内部）；其头部 ✕（走 agentSessions.drawerOpen，
// 与本栏的 focusLayout.railOpen 无关）在 .focus-rail 作用域内由 CSS 隐藏，收起走本栏 « 按钮。
export function SessionRail() {
  const { t } = useI18n();
  const railOpen = useSession((s) => s.focusLayout.railOpen);
  const setFocusLayout = useSession((s) => s.setFocusLayout);
  const loading = useAgentSessions((s) => s.loading);
  const newSession = useAgentSessions((s) => s.newSession);
  const layout = useSession((s) => s.focusLayout);

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
        {/* 右侧栏一级入口（SDD feats/01 v1.6 D20/D22）：舞台 / 文件 / 图谱，右侧栏自身不再有标签条 */}
        {!CHAT_EDITION && (
          <>
            <span className="focus-rail-sep" aria-hidden="true" />
            {WORKSPACE_ENTRIES.map((entry) => {
              const on = entry.pressed(layout);
              return (
                <button
                  key={entry.id}
                  className={"focus-iconbtn" + (on ? " on" : "")}
                  type="button"
                  title={t(on ? entry.onTitle : entry.label)}
                  aria-label={t(entry.label)}
                  aria-pressed={on}
                  onClick={() => setFocusLayout(entry.next(layout))}
                >
                  <Icon icon={TAB_ICON[entry.id]} size="md" />
                </button>
              );
            })}
          </>
        )}
      </div>
      {railOpen && (
        <div className="focus-rail-body">
          <SessionDrawer />
        </div>
      )}
    </div>
  );
}
