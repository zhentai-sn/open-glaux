/** SDD 17 §4.1：Skills、提示词模板、自定义说明的位置与名称规则。 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { RuntimeError } from "../errors.js";
import { glauxHome } from "../permission/settings.js";

export type ResourceSource = "builtin" | "user" | "project";

/** 内置 Skills：`agent-runtime/skills/`（源码与 dist 下都相对包根两级）。 */
export const BUILTIN_SKILLS_DIR = fileURLToPath(new URL("../../skills/", import.meta.url));

export function userSkillsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(glauxHome(env), "skills");
}
export function userPromptsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(glauxHome(env), "prompts");
}
export function userInstructionsPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(glauxHome(env), "GLAUX.md");
}
export function projectSkillsDir(projectDir: string): string {
  return join(projectDir, ".glaux", "skills");
}
export function projectPromptsDir(projectDir: string): string {
  return join(projectDir, ".glaux", "prompts");
}
export function projectInstructionsPath(projectDir: string): string {
  return join(projectDir, "GLAUX.md");
}

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** 小写字母、数字、连字符，1～64 字符（§7.5 规则 2）。 */
export function assertResourceName(name: string): string {
  if (name.length < 1 || name.length > 64 || !NAME.test(name)) {
    throw new RuntimeError("invalid_name", "Names use lowercase letters, digits and hyphens (1-64 characters).", 422);
  }
  return name;
}

export interface ResourceDirs {
  skills: { source: ResourceSource; path: string }[];
  prompts: { source: "user" | "project"; path: string }[];
  instructions: { scope: "user" | "project"; path: string }[];
}

export function resourceDirs(options: { projectDir?: string; env?: NodeJS.ProcessEnv; builtinSkillsDir?: string }): ResourceDirs {
  const env = options.env ?? process.env;
  const project = options.projectDir;
  return {
    skills: [
      { source: "builtin", path: options.builtinSkillsDir ?? BUILTIN_SKILLS_DIR },
      { source: "user", path: userSkillsDir(env) },
      ...(project ? [{ source: "project" as const, path: projectSkillsDir(project) }] : []),
    ],
    prompts: [
      { source: "user", path: userPromptsDir(env) },
      ...(project ? [{ source: "project" as const, path: projectPromptsDir(project) }] : []),
    ],
    instructions: [
      { scope: "user", path: userInstructionsPath(env) },
      ...(project ? [{ scope: "project" as const, path: projectInstructionsPath(project) }] : []),
    ],
  };
}
