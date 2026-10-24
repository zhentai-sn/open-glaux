import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";

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

/** 会话列表的两个页签（SDD 13 §7.4 规则 8）：归档不再是混在进行中列表里的开关。 */
type SessionTab = "active" | "archived";

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

interface MenuItem {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  danger?: boolean;
}

/**
 * 会话行的「更多操作」（SDD 13 §7.4 规则 12）：置顶、重命名、归档/恢复、复制会话 ID、删除。
 * 弹层挂到 body（fixed 定位）：会话列表是自身的滚动容器，留在行内会被裁切。
 */
function SessionMenu({ session }: { session: SessionListItem }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ right: number; top: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const renameSession = useAgentSessions((state) => state.renameSession);
  const setSessionStatus = useAgentSessions((state) => state.setSessionStatus);
  const setPinned = useAgentSessions((state) => state.setPinned);
  const deleteSession = useAgentSessions((state) => state.deleteSession);
  const notify = useSession((state) => state.notify);

  const MENU_W = 212;
  const MENU_H = 196;

  useLayoutEffect(() => {
    if (!open) {
      setAnchor(null);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setAnchor({
      right: Math.max(8, window.innerWidth - rect.right),
      // 默认贴着按钮下沿，下方空间不足时上移，别把菜单顶出视口
      top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - MENU_H - 8)),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>("button")?.focus();
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open, anchor]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(session.session_id);
      notify("info", t("agent_copied_id"));
    } catch {
      notify("crit", t("agent_copy_failed"));
    }
  };

  const remove = () => {
    // 未归属会话有自己的工作区，删除会话时一并删除（SDD 16 §7.6）
    const key = session.project_id ? "agent_delete_confirm" : "agent_delete_confirm_workspace";
    if (window.confirm(t(key, { title: session.title }))) void deleteSession(session.session_id);
  };

  const items: MenuItem[] = [
    {
      label: session.pinned ? t("agent_unpin") : t("agent_pin"),
      icon: session.pinned ? ICONS.unpin : ICONS.pin,
      onSelect: () => void setPinned(session.session_id, !session.pinned),
    },
    {
      label: t("agent_rename"),
      icon: ICONS.edit,
      onSelect: () => {
        const title = window.prompt(t("agent_rename"), session.title);
        if (title?.trim()) void renameSession(session.session_id, title.trim());
      },
    },
    session.status === "active"
      ? {
        label: t("agent_archive"),
        icon: ICONS.archive,
        onSelect: () => void setSessionStatus(session.session_id, "archived"),
      }
      : {
        label: t("agent_restore"),
        icon: ICONS.unarchive,
        onSelect: () => void setSessionStatus(session.session_id, "active"),
      },
    { label: t("agent_copy_id"), icon: ICONS.copy, onSelect: () => void copyId() },
    { label: t("agent_delete"), icon: ICONS.trash, onSelect: remove, danger: true },
  ];

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const buttons = [...(menuRef.current?.querySelectorAll("button") ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    buttons[(at + step + buttons.length) % buttons.length]?.focus();
  };

  return (
    <div className="session-more">
      <button
        ref={triggerRef}
        type="button"
        className={`session-more-btn${open ? " open" : ""}`}
        title={t("agent_more_actions")}
        aria-label={t("agent_more_actions")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon icon={ICONS.more} size="sm" />
      </button>
      {open && anchor && createPortal(
        <div
          ref={menuRef}
          className="session-menu"
          role="menu"
          aria-label={t("agent_more_actions")}
          style={{ right: anchor.right, top: anchor.top, width: MENU_W }}
          onKeyDown={onMenuKey}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={item.danger ? "danger" : undefined}
              onClick={() => {
                close();
                item.onSelect();
              }}
            >
              <Icon icon={item.icon} size="sm" />
              <span>{item.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
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
      <div className="session-row-tools">
        {session.pinned && (
          <span className="session-pin" title={t("agent_pinned")} aria-label={t("agent_pinned")} role="img">
            <Icon icon={ICONS.pin} size="sm" />
          </span>
        )}
        <SessionMenu session={session} />
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
  const [tab, setTab] = useState<SessionTab>("active");
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (!loaded) void refresh().catch(() => undefined);
  }, [loaded, refresh]);

  const query = search.trim().toLocaleLowerCase();
  // 页签即归档归属（§7.4 规则 8）：进行中 / 已归档各自成列，搜索只在当前页签内生效。
  const visible = sessions.filter(
    (session) =>
      session.status === tab && session.title.toLocaleLowerCase().includes(query),
  );
  // 项目列表未加载成功（后端未起、局域网访问被回环守卫拒绝）时，用见过的项目兜底分组，
  // 不把项目会话误判为「已移除」；只读判定同样要求列表已加载（AgentConversation）
  const effective: ProjectView[] = loaded
    ? projects
    : Object.entries(known).map(([id, k]) => ({ id, ...k, created_at: "", status: "ok" as const }));
  const groups = buildSessionGroups(visible, effective, known).filter((group) => {
    // 搜索与已归档页签只留有内容的组；进行中页签保留组头（保留组内的新建入口）
    if (query || tab === "archived") return group.sessions.length > 0;
    return group.kind !== "removed" || group.sessions.length > 0;
  });

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
      <div className="session-tabs" role="tablist" aria-label={t("agent_history")}>
        {(["active", "archived"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={tab === value ? "on" : undefined}
            onClick={() => setTab(value)}
          >
            {t(value === "active" ? "agent_tab_active" : "agent_tab_archived")}
          </button>
        ))}
      </div>
      <input
        className="session-search"
        type="search"
        placeholder={t("agent_search_sessions")}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="session-list">
        {(query || tab === "archived") && !groups.length && (
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
      {pickerOpen && <FolderPicker onClose={() => setPickerOpen(false)} onOpened={opened} />}
    </div>
  );
}
