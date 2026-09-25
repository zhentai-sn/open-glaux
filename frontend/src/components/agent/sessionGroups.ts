// 会话按项目分组（SDD 13 §7.4 规则 1～4）。纯函数，SessionDrawer 渲染、单测直接断言。
import type { ProjectView } from "../../api/types";
import type { SessionListItem } from "../../agent/runtime/types";
import { projectLabel, UNASSIGNED, type KnownProject } from "../../store/projects";

export type SessionGroupKind = "project" | "unassigned" | "removed";

export interface SessionGroupModel {
  /** project_id；未归属组为 UNASSIGNED。 */
  id: string;
  kind: SessionGroupKind;
  projectId: string | null;
  label: string;
  /** 组头悬停显示的完整路径（显示写法）。 */
  path: string;
  /** 项目目录已被删除或不可读（§11.1 路径失效）。 */
  missing: boolean;
  sessions: SessionListItem[];
}

const latest = (sessions: SessionListItem[]): string =>
  sessions.reduce((max, s) => (s.updated_at > max ? s.updated_at : max), "");

/**
 * 分组顺序：有会话的项目按组内最近会话倒序；无会话的项目按登记时间倒序；其后「未归属」；
 * 最后是已移除项目的只读组。组内沿用传入顺序（调用方已按 updated_at 倒序）。
 */
export function buildSessionGroups(
  sessions: SessionListItem[],
  projects: ProjectView[],
  known: Record<string, KnownProject>,
): SessionGroupModel[] {
  const byProject = new Map<string | null, SessionListItem[]>();
  for (const s of sessions) {
    const key = s.project_id ?? null;
    byProject.set(key, [...(byProject.get(key) ?? []), s]);
  }
  const registered = new Set(projects.map((p) => p.id));
  const labels = projects.map((p) => ({ name: p.name, path: p.path, display_path: p.display_path }));

  const projectGroups = projects.map<SessionGroupModel>((p) => ({
    id: p.id,
    kind: "project",
    projectId: p.id,
    label: projectLabel(p, labels),
    path: p.display_path,
    missing: p.status === "missing",
    sessions: byProject.get(p.id) ?? [],
  }));
  const created = new Map(projects.map((p) => [p.id, p.created_at]));
  projectGroups.sort((a, b) => {
    if (a.sessions.length && b.sessions.length) return latest(b.sessions).localeCompare(latest(a.sessions));
    if (a.sessions.length !== b.sessions.length && (!a.sessions.length || !b.sessions.length)) {
      return a.sessions.length ? -1 : 1;
    }
    return (created.get(b.id) ?? "").localeCompare(created.get(a.id) ?? "");
  });

  const unassigned: SessionGroupModel = {
    id: UNASSIGNED,
    kind: "unassigned",
    projectId: null,
    label: "",
    path: "",
    missing: false,
    sessions: byProject.get(null) ?? [],
  };

  const removed: SessionGroupModel[] = [];
  for (const [projectId, list] of byProject) {
    if (projectId === null || registered.has(projectId)) continue;
    const k = known[projectId];
    removed.push({
      id: projectId,
      kind: "removed",
      projectId,
      label: k?.name ?? projectId,
      path: k?.display_path ?? "",
      missing: false,
      sessions: list,
    });
  }
  removed.sort((a, b) => latest(b.sessions).localeCompare(latest(a.sessions)));

  return [...projectGroups, unassigned, ...removed];
}

/** 会话所在项目是否可发送：已移除或路径失效的项目只读（§7.4 规则 4、§11.1）。 */
export function projectWritable(projectId: string | null, projects: ProjectView[]): boolean {
  if (projectId === null) return true;
  const p = projects.find((item) => item.id === projectId);
  return !!p && p.status === "ok";
}
