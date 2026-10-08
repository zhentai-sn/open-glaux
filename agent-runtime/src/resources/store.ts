/**
 * SDD 17 §7.5：Skills、提示词模板、自定义说明的读写删与 Skills 启停。
 * 路径只由来源与校验过的名称拼出；写入先写临时文件再 rename。
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";

import { loadSkills } from "@earendil-works/pi-agent-core";

import { RuntimeError } from "../errors.js";
import { parseSettings, readSettingsFile, userSettingsPath } from "../permission/settings.js";
import { ResourceExecutionEnv } from "./execution-env.js";
import {
  assertResourceName,
  BUILTIN_SKILLS_DIR,
  projectInstructionsPath,
  projectPromptsDir,
  projectSkillsDir,
  userInstructionsPath,
  userPromptsDir,
  userSkillsDir,
  type ResourceSource,
} from "./paths.js";
import type { InstructionsItem, ResourceDiagnostic } from "./load.js";

export interface StoreContext {
  env?: NodeJS.ProcessEnv;
  builtinSkillsDir?: string;
  builtinAgentsDir?: string;
  /** 项目级操作所需；缺省时项目级请求返回 404 project_not_found。 */
  projectDir?: string;
}

function notFound(what: string): never {
  throw new RuntimeError("not_found", `${what} not found.`, 404);
}

function projectDirOf(ctx: StoreContext): string {
  if (!ctx.projectDir) throw new RuntimeError("project_not_found", "Project directory is unavailable.", 404);
  return ctx.projectDir;
}

export async function writeAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, content, "utf8");
  await rename(temp, path);
}

async function readOptional(path: string): Promise<string | undefined> {
  return readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
}

function parseSource(source: string, allowBuiltin: boolean): ResourceSource {
  if (source === "user" || source === "project" || (allowBuiltin && source === "builtin")) return source;
  if (source === "builtin") throw new RuntimeError("read_only", "Built-in resources are read-only.", 403);
  throw new RuntimeError("invalid_request", "Source must be user or project.", 400);
}

// ---- Skills ----

function skillsRoot(source: ResourceSource, ctx: StoreContext): string {
  if (source === "builtin") return ctx.builtinSkillsDir ?? BUILTIN_SKILLS_DIR;
  return source === "user" ? userSkillsDir(ctx.env) : projectSkillsDir(projectDirOf(ctx));
}

export function skillFile(source: string, name: string, ctx: StoreContext, allowBuiltin = true): string {
  return join(skillsRoot(parseSource(source, allowBuiltin), ctx), assertResourceName(name), "SKILL.md");
}

export async function getSkill(source: string, name: string, ctx: StoreContext) {
  const path = skillFile(source, name, ctx);
  const content = (await readOptional(path)) ?? notFound(`Skill ${name}`);
  return { name, source, path, content, editable: source !== "builtin" };
}

/** 写入后用 pi 加载器校验；不能解析成 Skill 时恢复原文件并拒绝（422 invalid_skill）。 */
export async function putSkill(source: string, name: string, content: string, ctx: StoreContext) {
  const path = skillFile(source, name, ctx, false);
  if (!content.trim()) throw new RuntimeError("invalid_skill", "Skill content is empty.", 422);
  const previous = await readOptional(path);
  await writeAtomic(path, content);
  const result = await loadSkills(new ResourceExecutionEnv({ cwd: "/" }), dirname(path));
  const loaded = result.skills.find((skill) => normalize(skill.filePath) === path);
  const diagnostics: ResourceDiagnostic[] = result.diagnostics.map((d) => ({ source: source as ResourceSource, code: d.code, message: d.message, path: normalize(d.path) }));
  if (!loaded) {
    if (previous === undefined) await rm(dirname(path), { recursive: true, force: true });
    else await writeAtomic(path, previous);
    throw new RuntimeError("invalid_skill", diagnostics.map((d) => d.message).join("; ") || "SKILL.md could not be parsed.", 422);
  }
  const disabled = (await readSettingsFile(userSettingsPath(ctx.env))).file?.skillsDisabled ?? [];
  return {
    item: {
      name: loaded.name, description: loaded.description, source, path,
      enabled: !disabled.includes(loaded.name), model_invocable: !loaded.disableModelInvocation,
    },
    diagnostics,
  };
}

export async function deleteSkill(source: string, name: string, ctx: StoreContext): Promise<void> {
  const path = skillFile(source, name, ctx, false);
  if ((await readOptional(path)) === undefined) notFound(`Skill ${name}`);
  await rm(dirname(path), { recursive: true, force: true });
}

/** 修改用户级设置的 `skills.disabled`，保留其他字段；现有文件不合法时拒绝覆盖。 */
export async function setSkillEnabled(name: string, enabled: boolean, ctx: StoreContext): Promise<void> {
  assertResourceName(name);
  const path = userSettingsPath(ctx.env);
  const raw = await readOptional(path);
  let document: Record<string, unknown> = {};
  if (raw !== undefined) {
    try {
      parseSettings(path, raw);
    } catch (error) {
      throw new RuntimeError("invalid_settings", `Settings file is invalid: ${(error as Error).message}`, 409);
    }
    document = JSON.parse(raw) as Record<string, unknown>;
  }
  const skills = (document.skills && typeof document.skills === "object" ? { ...(document.skills as object) } : {}) as Record<string, unknown>;
  const disabled = new Set(Array.isArray(skills.disabled) ? (skills.disabled as string[]) : []);
  if (enabled) disabled.delete(name);
  else disabled.add(name);
  skills.disabled = [...disabled].sort();
  await writeAtomic(path, `${JSON.stringify({ ...document, skills }, null, 2)}\n`);
}

// ---- 提示词模板 ----

export function templateFile(source: string, name: string, ctx: StoreContext): string {
  const parsed = parseSource(source, false);
  const root = parsed === "user" ? userPromptsDir(ctx.env) : projectPromptsDir(projectDirOf(ctx));
  return join(root, `${assertResourceName(name)}.md`);
}

export async function getTemplate(source: string, name: string, ctx: StoreContext) {
  const path = templateFile(source, name, ctx);
  const content = (await readOptional(path)) ?? notFound(`Template ${name}`);
  return { name, source, path, content };
}

export async function putTemplate(source: string, name: string, content: string, ctx: StoreContext) {
  const path = templateFile(source, name, ctx);
  if (!content.trim()) throw new RuntimeError("invalid_request", "Template content is empty.", 422);
  await writeAtomic(path, content);
  return { name, source, path };
}

export async function deleteTemplate(source: string, name: string, ctx: StoreContext): Promise<void> {
  const path = templateFile(source, name, ctx);
  if ((await readOptional(path)) === undefined) notFound(`Template ${name}`);
  await rm(path, { force: true });
}

// ---- 自定义说明 ----

export function instructionsFile(scope: string, ctx: StoreContext): string {
  if (scope === "user") return userInstructionsPath(ctx.env);
  if (scope === "project") return projectInstructionsPath(projectDirOf(ctx));
  throw new RuntimeError("invalid_request", "Scope must be user or project.", 400);
}

export async function getInstructions(scope: string, ctx: StoreContext) {
  const path = instructionsFile(scope, ctx);
  return { scope, path, content: (await readOptional(path)) ?? "" };
}

/** 空内容删除文件（说明段随之省略）。 */
export async function putInstructions(scope: string, content: string, ctx: StoreContext): Promise<InstructionsItem> {
  const path = instructionsFile(scope, ctx);
  if (!content.trim()) {
    await rm(path, { force: true });
    return { scope: scope as InstructionsItem["scope"], path, exists: false, bytes: 0 };
  }
  await writeAtomic(path, content);
  return { scope: scope as InstructionsItem["scope"], path, exists: true, bytes: (await stat(path)).size };
}
