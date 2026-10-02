/** 命令开始时加载设置文件与会话授权（SDD 15 §4.3、§7.6 规则 9）。 */
import type { Session } from "@earendil-works/pi-agent-core";

import { backendBaseUrl } from "../atlas/client.js";
import { PERMISSION_GRANT_ENTRY } from "./plugin.js";
import { loadSettings, projectSettingsPath, userSettingsPath, type LoadedSettings } from "./settings.js";

const PROJECT_LOOKUP_TIMEOUT_MS = 5_000;

/** 经 backend `GET /projects` 取项目目录；backend 不可达或项目不存在时返回 undefined（§13）。 */
async function projectDirOf(projectId: string, fetchImpl: typeof fetch = fetch): Promise<string | undefined> {
  try {
    const response = await fetchImpl(`${backendBaseUrl().replace(/\/+$/u, "")}/projects`, {
      signal: AbortSignal.timeout(PROJECT_LOOKUP_TIMEOUT_MS),
    });
    if (!response.ok) return undefined;
    const projects = (await response.json()) as { id?: unknown; path?: unknown }[];
    const match = Array.isArray(projects) ? projects.find((project) => project?.id === projectId) : undefined;
    return typeof match?.path === "string" && match.path ? match.path : undefined;
  } catch {
    return undefined;
  }
}

export async function defaultLoadSettings(projectId?: string): Promise<{ settings: LoadedSettings; alwaysPath: string }> {
  const projectDir = projectId ? await projectDirOf(projectId) : undefined;
  const settings = await loadSettings(projectDir ? { projectDir } : {});
  return { settings, alwaysPath: projectDir ? projectSettingsPath(projectDir) : userSettingsPath() };
}

/** 从会话记录恢复「本会话允许」过的工具。 */
export async function restoreGrants(session: Session): Promise<Set<string>> {
  const grants = new Set<string>();
  for (const entry of await session.getEntries()) {
    if (entry.type !== "custom" || entry.customType !== PERMISSION_GRANT_ENTRY) continue;
    const tool = (entry.data as { tool?: unknown } | undefined)?.tool;
    if (typeof tool === "string") grants.add(tool);
  }
  return grants;
}
