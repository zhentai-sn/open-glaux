// 项目列表（SDD 13 §7.1、§7.4）：侧栏分组、项目胶囊与目录选择器共用。
// 项目登记由后端持有（D-6）；这里只缓存列表，另记住见过的项目名与路径——项目被移除后，
// 其会话进入「<项目名>（已移除）」只读组，组头要显示原名并能按原路径重新打开（§7.4 规则 4）。
import { create } from "zustand";

import { api } from "../api/client";
import type { ProjectView } from "../api/types";

const KNOWN_KEY = "glaux.projects.known.v1";
const COLLAPSED_KEY = "glaux.projects.collapsed.v1";

export interface KnownProject {
  name: string;
  path: string;
  display_path: string;
}

interface ProjectsState {
  projects: ProjectView[];
  loaded: boolean;
  /** 见过的项目（含已移除的），键为 project_id。 */
  known: Record<string, KnownProject>;
  /** 折叠的组，键为 project_id；未归属组用 UNASSIGNED。 */
  collapsed: Record<string, true>;
  showArchived: boolean;
  /** 智能体写入项目文件的次数，按 project_id 计；目录树据此重新加载（SDD 16 §7.4 规则 3）。只存内存。 */
  fileChanges: Record<string, number>;

  refresh: () => Promise<void>;
  bumpFileChange: (projectId: string) => void;
  open: (path: string) => Promise<ProjectView>;
  remove: (id: string) => Promise<void>;
  toggleCollapsed: (groupId: string) => void;
  setShowArchived: (show: boolean) => void;
}

export const UNASSIGNED = "__unassigned__";

function readJson<T extends object>(key: string): T {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "{}") as unknown;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as T) : ({} as T);
  } catch {
    return {} as T;
  }
}

function writeJson(key: string, value: object): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 偏好持久化失败不阻塞 */
  }
}

function remember(known: Record<string, KnownProject>, list: ProjectView[]): Record<string, KnownProject> {
  const next = { ...known };
  for (const p of list) next[p.id] = { name: p.name, path: p.path, display_path: p.display_path };
  return next;
}

export const useProjects = create<ProjectsState>((set, get) => ({
  projects: [],
  loaded: false,
  known: readJson<Record<string, KnownProject>>(KNOWN_KEY),
  collapsed: readJson<Record<string, true>>(COLLAPSED_KEY),
  showArchived: false,
  fileChanges: {},

  bumpFileChange: (projectId) =>
    set((state) => ({ fileChanges: { ...state.fileChanges, [projectId]: (state.fileChanges[projectId] ?? 0) + 1 } })),

  refresh: async () => {
    const projects = await api.projects();
    const known = remember(get().known, projects);
    writeJson(KNOWN_KEY, known);
    set({ projects, known, loaded: true });
  },

  open: async (path) => {
    const project = await api.openProject(path);
    await get().refresh();
    return project;
  },

  remove: async (id) => {
    await api.removeProject(id);
    await get().refresh();
  },

  toggleCollapsed: (groupId) => {
    const collapsed = { ...get().collapsed };
    if (collapsed[groupId]) delete collapsed[groupId];
    else collapsed[groupId] = true;
    writeJson(COLLAPSED_KEY, collapsed);
    set({ collapsed });
  },

  setShowArchived: (showArchived) => set({ showArchived }),
}));

/**
 * 组头显示名：同名项目追加父目录名以区分（§7.1 规则 5）。
 * 父目录取 ``display_path`` 的倒数第二段，兼容 POSIX 与 Windows 两种显示写法。
 */
export function projectLabel(project: KnownProject, all: KnownProject[]): string {
  const clash = all.filter((p) => p.name === project.name && p.path !== project.path).length > 0;
  if (!clash) return project.name;
  const parts = project.display_path.split(/[\\/]+/u).filter(Boolean);
  const parent = parts.length >= 2 ? parts[parts.length - 2] : "";
  return parent ? `${project.name} · ${parent}` : project.name;
}
