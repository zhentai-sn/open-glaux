import { useEffect, useRef, useState } from "react";

import type { ProjectView } from "../../api/types";
import { useI18n } from "../../i18n";
import { useAgentSessions } from "../../store/agentSessions";
import { useProjects } from "../../store/projects";
import { Icon } from "../Icon";
import { ICONS } from "../iconMap";
import { FolderPicker } from "./FolderPicker";

// 输入区项目胶囊（SDD 13 §7.5）：显示当前会话所属项目，与左侧栏共用同一个「当前会话」。
// 空会话可切项目 = 切到目标项目的空会话并带走草稿（D-7）；发出消息后只读。
export function ProjectChip() {
  const { t } = useI18n();
  const currentSessionId = useAgentSessions((state) => state.currentSessionId);
  const projectId = useAgentSessions((state) =>
    state.sessions.find((s) => s.session_id === state.currentSessionId)?.project_id ?? null,
  );
  const empty = useAgentSessions((state) => {
    const id = state.currentSessionId;
    if (!id) return false;
    const view = state.views[id];
    const live = state.live[id];
    return !!view && view.messages.length === 0 && !live?.pendingUser && !live?.pendingImages?.length;
  });
  const loading = useAgentSessions((state) => state.loading);
  const newSession = useAgentSessions((state) => state.newSession);
  const projects = useProjects((state) => state.projects);
  const known = useProjects((state) => (projectId ? state.known[projectId] : undefined));
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  if (!currentSessionId) return null;
  const label = projectId ? (known?.name ?? projectId) : t("project_none_chip");
  const path = known?.display_path ?? "";
  const editable = empty && !loading;

  const choose = async (target: string | null) => {
    setMenuOpen(false);
    if (target === projectId) return;
    await newSession(target, { carryComposer: true });
  };

  const opened = async (project: ProjectView) => {
    setPickerOpen(false);
    await choose(project.id);
  };

  return (
    <div className="project-chip-wrap" ref={rootRef}>
      <button
        type="button"
        className={`project-chip${editable ? "" : " locked"}`}
        title={editable ? path || t("project_chip_title") : path || t("project_chip_locked")}
        aria-haspopup={editable ? "menu" : undefined}
        aria-expanded={editable ? menuOpen : undefined}
        aria-disabled={!editable || undefined}
        onClick={() => editable && setMenuOpen((open) => !open)}
      >
        <Icon icon={ICONS.folder} size="sm" />
        <span>{label}</span>
        {editable && <Icon icon={ICONS.chevronDown} size="sm" />}
      </button>
      {menuOpen && (
        <div className="project-chip-menu" role="menu">
          {projects.filter((p) => p.status === "ok").map((p) => (
            <button
              key={p.id}
              type="button"
              role="menuitemradio"
              aria-checked={p.id === projectId}
              title={p.display_path}
              onClick={() => void choose(p.id)}
            >
              <Icon icon={p.id === projectId ? ICONS.check : ICONS.folder} size="sm" />
              <span>{p.name}</span>
            </button>
          ))}
          <button
            type="button"
            role="menuitemradio"
            aria-checked={projectId === null}
            onClick={() => void choose(null)}
          >
            <Icon icon={projectId === null ? ICONS.check : ICONS.chat} size="sm" />
            <span>{t("project_unassigned")}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="project-chip-open"
            onClick={() => {
              setMenuOpen(false);
              setPickerOpen(true);
            }}
          >
            <Icon icon={ICONS.folderPlus} size="sm" />
            <span>{t("project_open_folder_ellipsis")}</span>
          </button>
        </div>
      )}
      {pickerOpen && <FolderPicker onClose={() => setPickerOpen(false)} onOpened={opened} />}
    </div>
  );
}
