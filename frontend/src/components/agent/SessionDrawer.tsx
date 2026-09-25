import { useEffect, useState } from "react";

import { agentRuntimeApi } from "../../agent/runtime/client";
import type { SessionListItem, SessionPhase } from "../../agent/runtime/types";
import type { ProjectView } from "../../api/types";
import { useI18n } from "../../i18n";
import { useAgentSessions } from "../../store/agentSessions";
import { useProjects } from "../../store/projects";
import { useSession } from "../../store/session";
import { Icon } from "../Icon";
import { ICONS } from "../iconMap";
import { FolderPicker } from "./FolderPicker";
import { buildSessionGroups, type SessionGroupModel } from "./sessionGroups";

const RUNNING: SessionPhase[] = ["running", "stopping", "compacting"];

// 会话状态点（SDD 13 §7.4 规则 5）：运行中 / 已完成未读 / 出错；空闲不显示，但占位保持对齐。
function StatusDot({ session }: { session: SessionListItem }) {
  const { t } = useI18n();
  const unread = useAgentSessions((state) => Boolean(state.unread[session.session_id]));
  const state = RUNNING.includes(session.phase)
    ? "running"
    : session.phase === "error"
      ? "error"
      : unread
        ? "unread"
        : null;
  if (!state) return <span className="session-dot" aria-hidden="true" />;
  const label = t(`session_state_${state}`);
  return <span className={`session-dot ${state}`} role="img" aria-label={label} title={label} />;
}

function SessionRow({
  session,
  current,
}: {
  session: SessionListItem;
  current: boolean;
}) {
  const { t } = useI18n();
  const selectSession = useAgentSessions((state) => state.selectSession);
  const renameSession = useAgentSessions((state) => state.renameSession);
  const setSessionStatus = useAgentSessions((state) => state.setSessionStatus);
  const deleteSession = useAgentSessions((state) => state.deleteSession);

  return (
    <div
      className={`session-item${current ? " active" : ""}${session.status === "archived" ? " archived" : ""}`}
    >
      <button
        className="session-select"
        type="button"
        aria-current={current || undefined}
        onClick={() => void selectSession(session.session_id)}
      >
        <StatusDot session={session} />
        <span className="session-text">
          <span>{session.title}</span>
          <small>{new Date(session.updated_at).toLocaleString()}</small>
        </span>
      </button>
      <div className="session-actions">
        <button
          type="button"
          title={t("agent_rename")}
          onClick={() => {
            const title = window.prompt(t("agent_rename"), session.title);
            if (title?.trim()) {
              void renameSession(session.session_id, title.trim());
            }
          }}
        >
          <Icon icon={ICONS.edit} size="sm" />
        </button>
        <button
          type="button"
          title={
            session.status === "active"
              ? t("agent_archive")
              : t("agent_restore")
          }
          onClick={() =>
            void setSessionStatus(
              session.session_id,
              session.status === "active" ? "archived" : "active",
            )
          }
        >
          <Icon icon={session.status === "active" ? ICONS.archive : ICONS.chevronUp} size="sm" />
        </button>
        <button
          type="button"
          title={t("agent_delete")}
          onClick={() => {
            if (
              window.confirm(
                t("agent_delete_confirm", { title: session.title }),
              )
            ) {
              void deleteSession(session.session_id);
            }
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}

function SessionGroup({
  group,
  sessions,
  currentSessionId,
  expanded,
}: {
  group: SessionGroupModel;
  sessions: SessionListItem[];
  currentSessionId: string | null;
  /** 搜索时强制展开命中的组（§7.4 规则 7）。 */
  expanded: boolean;
}) {
  const { t } = useI18n();
  const loading = useAgentSessions((state) => state.loading);
  const newSession = useAgentSessions((state) => state.newSession);
  const collapsed = useProjects((state) => Boolean(state.collapsed[group.id])) && !expanded;
  const toggleCollapsed = useProjects((state) => state.toggleCollapsed);
  const removeProject = useProjects((state) => state.remove);
  const openProject = useProjects((state) => state.open);
  const known = useProjects((state) => (group.projectId ? state.known[group.projectId] : undefined));
  const notify = useSession((state) => state.notify);

  const label =
    group.kind === "unassigned"
      ? t("project_unassigned")
      : group.kind === "removed"
        ? t("project_removed_label", { name: group.label })
        : group.label;
  // 折叠不隐藏当前会话（§7.4 规则 11）
  const shown = collapsed
    ? sessions.filter((s) => s.session_id === currentSessionId)
    : sessions;

  const remove = async () => {
    if (!group.projectId) return;
    // 运行中检查以 agent-runtime 的最新列表为准（D-16）；检查与删除之间不保证原子性
    let running = false;
    try {
      const fresh = await agentRuntimeApi.listSessions("active");
      running = fresh.some((s) => s.project_id === group.projectId && RUNNING.includes(s.phase));
    } catch {
      notify("crit", t("project_remove_failed"));
      return;
    }
    if (running) {
      notify("crit", t("project_remove_running", { name: group.label }));
      return;
    }
    if (!window.confirm(t("project_remove_confirm", { name: group.label }))) return;
    try {
      await removeProject(group.projectId);
    } catch {
      notify("crit", t("project_remove_failed"));
    }
  };

  const reopen = async () => {
    if (!known) return;
    try {
      await openProject(known.path);
    } catch {
      notify("crit", t("project_reopen_failed", { path: known.display_path }));
    }
  };

  return (
    <section className={`session-group ${group.kind}${group.missing ? " missing" : ""}`}>
      <div className="session-group-head">
        <button
          type="button"
          className="session-group-toggle"
          aria-expanded={!collapsed}
          title={group.path || label}
          onClick={() => toggleCollapsed(group.id)}
        >
          <Icon icon={collapsed ? ICONS.chevronRight : ICONS.chevronDown} size="sm" />
          <Icon icon={group.kind === "unassigned" ? ICONS.chat : ICONS.folder} size="sm" />
          <span className="session-group-name">{label}</span>
          {group.missing && (
            <span className="session-group-warn" title={t("project_missing")} aria-label={t("project_missing")}>
              <Icon icon={ICONS.warning} size="sm" />
            </span>
          )}
        </button>
        <div className="session-group-actions">
          {group.kind === "removed" ? (
            known && (
              <button type="button" title={t("project_reopen")} onClick={() => void reopen()}>
                <Icon icon={ICONS.regenerate} size="sm" />
              </button>
            )
          ) : (
            <button
              type="button"
              title={t("project_new_session")}
              aria-label={t("project_new_session")}
              disabled={loading || group.missing}
              onClick={() => void newSession(group.projectId)}
            >
              <Icon icon={ICONS.plus} size="sm" />
            </button>
          )}
          {group.kind === "project" && (
            <button type="button" title={t("project_remove")} onClick={() => void remove()}>
              <Icon icon={ICONS.trash} size="sm" />
            </button>
          )}
        </div>
      </div>
      {shown.map((session) => (
        <SessionRow
          key={session.session_id}
          session={session}
          current={session.session_id === currentSessionId}
        />
      ))}
    </section>
  );
}

// 会话列表按项目分组（SDD 13 §7.4）；Focus 左侧栏与 Workbench 对话面板共用。
export function SessionDrawer() {
  const { t } = useI18n();
  const sessions = useAgentSessions((state) => state.sessions);
  const currentSessionId = useAgentSessions(
    (state) => state.currentSessionId,
  );
  const search = useAgentSessions((state) => state.search);
  const setSearch = useAgentSessions((state) => state.setSearch);
  const setDrawerOpen = useAgentSessions((state) => state.setDrawerOpen);
  const newSession = useAgentSessions((state) => state.newSession);
  const projects = useProjects((state) => state.projects);
  const known = useProjects((state) => state.known);
  const loaded = useProjects((state) => state.loaded);
  const refresh = useProjects((state) => state.refresh);
  const showArchived = useProjects((state) => state.showArchived);
  const setShowArchived = useProjects((state) => state.setShowArchived);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (!loaded) void refresh().catch(() => undefined);
  }, [loaded, refresh]);

  const query = search.trim().toLocaleLowerCase();
  // 归档默认隐藏；打开开关或正在搜索时显示（§7.4 规则 7、8）
  const visible = sessions.filter(
    (session) =>
      (showArchived || query || session.status === "active") &&
      session.title.toLocaleLowerCase().includes(query),
  );
  const groups = buildSessionGroups(visible, projects, known).filter(
    // 搜索时只留命中的组；平时项目组与「未归属」组即使为空也渲染（保留组头的新建入口）
    (group) => (query ? group.sessions.length > 0 : group.kind !== "removed" || group.sessions.length > 0),
  );

  const opened = async (project: ProjectView) => {
    setPickerOpen(false);
    await newSession(project.id);
  };

  return (
    <div className="session-drawer" aria-label={t("agent_history")}>
      <div className="session-drawer-head">
        <b>{t("agent_history")}</b>
        <div className="session-drawer-tools">
          <button
            type="button"
            className="session-open-folder"
            title={t("project_open_folder")}
            aria-label={t("project_open_folder")}
            onClick={() => setPickerOpen(true)}
          >
            <Icon icon={ICONS.folderPlus} size="sm" />
          </button>
          <button
            type="button"
            className="session-drawer-close"
            aria-label="Close"
            onClick={() => setDrawerOpen(false)}
          >
            <Icon icon={ICONS.close} size="sm" />
          </button>
        </div>
      </div>
      <input
        className="session-search"
        type="search"
        placeholder={t("agent_search_sessions")}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="session-list">
        {query && !groups.length && (
          <div className="agent-empty">{t("agent_no_sessions")}</div>
        )}
        {groups.map((group) => (
          <SessionGroup
            key={group.id}
            group={group}
            sessions={group.sessions}
            currentSessionId={currentSessionId}
            expanded={Boolean(query)}
          />
        ))}
      </div>
      <label className="session-archived-toggle">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(event) => setShowArchived(event.target.checked)}
        />
        {t("project_show_archived")}
      </label>
      {pickerOpen && <FolderPicker onClose={() => setPickerOpen(false)} onOpened={opened} />}
    </div>
  );
}
