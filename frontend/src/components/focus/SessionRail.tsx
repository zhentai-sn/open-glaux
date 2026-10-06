import { useEffect, useRef } from "react";
import { type LucideIcon } from "lucide-react";

import { CHAT_EDITION } from "../../edition";
import { useI18n, type I18nKey } from "../../i18n";
import { useAgentSessions } from "../../store/agentSessions";
import { useProjects } from "../../store/projects";
import { useSession, type FocusLayout } from "../../store/session";
import { SessionDrawer } from "../agent/SessionDrawer";
import { confirmLeaveContext } from "../context/ContextPanel";
import { Icon } from "../Icon";
import { ICONS, TAB_ICON } from "../iconMap";

// 右侧栏入口的按下态与点击语义（SDD feats/01 v1.6 D22 / v1.7 D23，活动栏式）：
// - 舞台：未按下 → 展开纯舞台；舞台 + 文件列 → 收掉文件列；只剩舞台 → 收起右侧栏。
// - 文件：未开 → 展开舞台并打开文件列；已开 → 关掉文件列。
// - 图谱 / 设置：未开 → 右侧换成该工作区；已开 → 收起右侧栏。
interface RailEntry {
  id: string;
  icon: LucideIcon;
  label: I18nKey;
  onTitle: I18nKey;
  pressed: (l: FocusLayout) => boolean;
  next: (l: FocusLayout) => Partial<FocusLayout>;
}

const WORKSPACE_ENTRIES: RailEntry[] = [
  {
    id: "stage",
    icon: TAB_ICON.stage,
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
    icon: TAB_ICON.files,
    label: "focus_tab_files",
    onTitle: "focus_browser_close",
    pressed: (l) => l.rightOpen && l.sideView === "stage" && l.browserView === "files",
    next: (l) =>
      l.rightOpen && l.sideView === "stage" && l.browserView === "files"
        ? { browserView: null }
        : { rightOpen: true, sideView: "stage", browserView: "files" },
  },
  // SDD 23 §7.6：标注面板与文件共用浏览器列，二者互换
  {
    id: "annotations",
    icon: TAB_ICON.annotations,
    label: "focus_tab_annotations",
    onTitle: "focus_browser_close",
    pressed: (l) => l.rightOpen && l.sideView === "stage" && l.browserView === "annotations",
    next: (l) =>
      l.rightOpen && l.sideView === "stage" && l.browserView === "annotations"
        ? { browserView: null }
        : { rightOpen: true, sideView: "stage", browserView: "annotations" },
  },
  {
    id: "atlas",
    icon: TAB_ICON.atlas,
    label: "focus_tab_atlas",
    onTitle: "focus_side_collapse",
    pressed: (l) => l.rightOpen && l.sideView === "atlas",
    next: (l) => (l.rightOpen && l.sideView === "atlas" ? { rightOpen: false } : { rightOpen: true, sideView: "atlas" }),
  },
  // SDD 19 §7.1：上下文页，与舞台、图谱同样和对话列并排。
  {
    id: "context",
    icon: TAB_ICON.context,
    label: "focus_tab_context",
    onTitle: "focus_side_collapse",
    pressed: (l) => l.rightOpen && l.sideView === "context",
    next: (l) => (l.rightOpen && l.sideView === "context" ? { rightOpen: false } : { rightOpen: true, sideView: "context" }),
  },
];

// 设置贴竖条底部；chat 发行版也有（连接配置是对话的前提）。
const SETTINGS_ENTRY: RailEntry = {
  id: "settings",
  icon: ICONS.config,
  label: "settings_title",
  onTitle: "focus_side_collapse",
  pressed: (l) => l.rightOpen && l.sideView === "settings",
  next: (l) => (l.rightOpen && l.sideView === "settings" ? { rightOpen: false } : { rightOpen: true, sideView: "settings" }),
};

function leaveSettings() {
  const { focusLayout, setFocusLayout } = useSession.getState();
  if (focusLayout.rightOpen && focusLayout.sideView === "settings") setFocusLayout({ rightOpen: false });
}

function RailEntryButton({ entry }: { entry: RailEntry }) {
  const { t } = useI18n();
  const layout = useSession((s) => s.focusLayout);
  const setFocusLayout = useSession((s) => s.setFocusLayout);
  const on = entry.pressed(layout);
  return (
    <button
      className={"focus-iconbtn" + (on ? " on" : "")}
      type="button"
      title={t(on ? entry.onTitle : entry.label)}
      aria-label={t(entry.label)}
      aria-pressed={on}
      onClick={() => {
        // 从上下文页切走或收起前确认未保存修改（SDD 19 §7.3 规则 2）
        const leaving = layout.rightOpen && layout.sideView === "context";
        if (leaving && !confirmLeaveContext(t("res_unsaved_confirm"))) return;
        setFocusLayout(entry.next(layout));
      }}
    >
      <Icon icon={entry.icon} size="md" />
    </button>
  );
}

// 会话栏（SDD feats/01 §8）——SessionDrawer 的薄壳：默认收窄为竖条，点击展开。
// 竖条同时承载一级入口：会话（☰ / ＋）、右侧栏的舞台 / 文件 / 图谱，以及底部的设置。
// 展开态常驻挂载 SessionDrawer（不改其内部）；其头部 ✕（走 agentSessions.drawerOpen，
// 与本栏的 focusLayout.railOpen 无关）在 .focus-rail 作用域内由 CSS 隐藏，收起走本栏 « 按钮。
export function SessionRail() {
  const { t } = useI18n();
  const railOpen = useSession((s) => s.focusLayout.railOpen);
  const setFocusLayout = useSession((s) => s.setFocusLayout);
  const loading = useAgentSessions((s) => s.loading);
  const newSession = useAgentSessions((s) => s.newSession);
  // ＋ 在当前会话的项目下新建（SDD 13 §7.4 规则 9、10），title 点明目标项目
  const projectId = useAgentSessions(
    (s) => s.sessions.find((x) => x.session_id === s.currentSessionId)?.project_id ?? null,
  );
  const projectName = useProjects((s) => (projectId ? (s.known[projectId]?.name ?? null) : null));
  const currentSessionId = useAgentSessions((s) => s.currentSessionId);

  // 设置页铺满时选会话或新建会话 = 回到对话（SDD feats/01 D29）。切换会话靠 currentSessionId 变化捕获，
  // 点当前会话 id 不变，由会话行的点击捕获兜住。
  // 初次载入（null → 会话）不算切换，刷新时停在设置页的用户不被踢回对话。
  const lastSession = useRef(currentSessionId);
  useEffect(() => {
    if (lastSession.current !== null && lastSession.current !== currentSessionId) leaveSettings();
    lastSession.current = currentSessionId;
  }, [currentSessionId]);

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
          title={projectName ? `${t("agent_new_session")} · ${projectName}` : t("agent_new_session")}
          disabled={loading}
          onClick={() => {
            leaveSettings();
            void newSession();
          }}
        >
          <Icon icon={ICONS.plus} size="md" />
        </button>
        {/* 右侧栏一级入口（SDD feats/01 v1.6 D20/D22）：舞台 / 文件 / 图谱，右侧栏自身不再有标签条 */}
        {!CHAT_EDITION && (
          <>
            <span className="focus-rail-sep" aria-hidden="true" />
            {WORKSPACE_ENTRIES.map((entry) => <RailEntryButton key={entry.id} entry={entry} />)}
          </>
        )}
        <span className="focus-rail-grow" />
        <RailEntryButton entry={SETTINGS_ENTRY} />
      </div>
      {railOpen && (
        <div
          className="focus-rail-body"
          onClickCapture={(e) => {
            if ((e.target as Element).closest(".session-select")) leaveSettings();
          }}
        >
          <SessionDrawer />
        </div>
      )}
    </div>
  );
}
