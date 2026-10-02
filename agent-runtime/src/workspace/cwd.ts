/**
 * SDD 16 §7.1、§7.6：命令的工作目录与会话工作区。
 * 绑定项目的会话以项目目录为工作目录；未归属会话在 `<workspacesRoot>/<session_id>/` 下工作。
 */
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { glauxHome } from "../permission/settings.js";

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** 缺省工作区根目录：`<GLAUX_HOME>/workspaces`。 */
export function defaultWorkspacesRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(glauxHome(env), "workspaces");
}

/** 工作区路径只由会话 id 派生；id 不是 UUID 时拒绝，避免路径穿越。 */
export function workspaceDir(root: string, sessionId: string): string {
  if (!SESSION_ID.test(sessionId)) throw new Error(`Invalid session id for workspace: ${sessionId}`);
  return join(root, sessionId);
}

export async function removeWorkspace(root: string, sessionId: string): Promise<void> {
  await rm(workspaceDir(root, sessionId), { recursive: true, force: true });
}

export interface ResolveCwdInput {
  sessionId: string;
  /** 会话绑定的项目；缺省为未归属。 */
  projectId?: string;
  /** backend 返回的项目目录；绑定项目但取不到时缺省。 */
  projectDir?: string;
  workspacesRoot: string;
}

/** 返回本命令的工作目录；取不到时返回 undefined，四个基础工具随之不挂载（§13）。 */
export async function resolveCwd(input: ResolveCwdInput): Promise<string | undefined> {
  if (input.projectId) return input.projectDir;
  const dir = workspaceDir(input.workspacesRoot, input.sessionId);
  try {
    await mkdir(dir, { recursive: true });
    return dir;
  } catch (error) {
    console.error("workspace unavailable", { dir, error });
    return undefined;
  }
}
