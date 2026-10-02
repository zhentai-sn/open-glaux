/**
 * SDD 15 §9.2：用户级与项目级设置文件。
 * 结构不合法时忽略整个文件并给出告警（D-15）；预算值越界只丢弃该值，按下一优先级取值（§7.8 规则 4）。
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { RuntimeWarning } from "../contracts.js";
import type { Decision, PermissionRule } from "./decide.js";

export interface BudgetSettings {
  max_turns?: number;
  max_minutes?: number;
}

export interface SettingsFile {
  path: string;
  rules: PermissionRule[];
  budget: BudgetSettings;
}

export interface LoadedSettings {
  user: SettingsFile | null;
  project: SettingsFile | null;
  warnings: RuntimeWarning[];
}

export const EMPTY_SETTINGS: LoadedSettings = { user: null, project: null, warnings: [] };

const DECISIONS: readonly Decision[] = ["allow", "deny", "ask"];
const BUDGET_RANGES = { max_turns: [1, 500], max_minutes: [1, 240] } as const;

/** 用户级目录：`GLAUX_HOME`，缺省 `~/.glaux`。 */
export function glauxHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.GLAUX_HOME?.trim() || join(homedir(), ".glaux");
}

export function userSettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(glauxHome(env), "settings.json");
}

export function projectSettingsPath(projectDir: string): string {
  return join(projectDir, ".glaux", "settings.json");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** 解析文件内容；结构错误抛出带原因的 Error。 */
export function parseSettings(path: string, raw: string): SettingsFile {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("not valid JSON");
  }
  if (!isObject(value)) throw new Error("top level must be an object");
  const rules: PermissionRule[] = [];
  if (value.permissions !== undefined) {
    if (!isObject(value.permissions)) throw new Error("permissions must be an object");
    const list = value.permissions.rules;
    if (list !== undefined) {
      if (!Array.isArray(list)) throw new Error("permissions.rules must be an array");
      list.forEach((item, index) => {
        if (!isObject(item)) throw new Error(`permissions.rules[${index}] must be an object`);
        if (typeof item.tool !== "string" || !item.tool.trim()) throw new Error(`permissions.rules[${index}].tool must be a non-empty string`);
        if (!DECISIONS.includes(item.decision as Decision)) throw new Error(`permissions.rules[${index}].decision must be allow, deny or ask`);
        if (item.pattern !== undefined && typeof item.pattern !== "string") throw new Error(`permissions.rules[${index}].pattern must be a string`);
        rules.push({ tool: item.tool.trim(), decision: item.decision as Decision, ...(typeof item.pattern === "string" ? { pattern: item.pattern } : {}) });
      });
    }
  }
  const budget: BudgetSettings = {};
  if (value.budget !== undefined) {
    if (!isObject(value.budget)) throw new Error("budget must be an object");
    for (const key of ["max_turns", "max_minutes"] as const) {
      const n = value.budget[key];
      if (n === undefined) continue;
      if (typeof n !== "number") throw new Error(`budget.${key} must be a number`);
      const [min, max] = BUDGET_RANGES[key];
      if (Number.isInteger(n) && n >= min && n <= max) budget[key] = n;
    }
  }
  return { path, rules, budget };
}

/** 读取单个设置文件：不存在为 null；不合法为 null 并给出告警。 */
export async function readSettingsFile(path: string): Promise<{ file: SettingsFile | null; warning?: RuntimeWarning }> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { file: null };
    return { file: null, warning: { code: "settings_unreadable", message: `Settings file ignored: ${(error as Error).message}`, path } };
  }
  try {
    return { file: parseSettings(path, raw) };
  } catch (error) {
    return { file: null, warning: { code: "settings_invalid", message: `Settings file ignored: ${(error as Error).message}`, path } };
  }
}

export async function loadSettings(options: { projectDir?: string; env?: NodeJS.ProcessEnv } = {}): Promise<LoadedSettings> {
  const user = await readSettingsFile(userSettingsPath(options.env));
  const project = options.projectDir ? await readSettingsFile(projectSettingsPath(options.projectDir)) : { file: null };
  return {
    user: user.file,
    project: project.file,
    warnings: [user.warning, project.warning].filter((warning): warning is RuntimeWarning => !!warning),
  };
}

export function allRules(settings: LoadedSettings): PermissionRule[] {
  return [...(settings.project?.rules ?? []), ...(settings.user?.rules ?? [])];
}

/**
 * 「总是允许」：追加 `{tool, decision: "allow"}`。先写临时文件再 rename；保留未知字段；
 * 已有完全相同的规则则不写。文件存在但不合法时拒绝写入，避免覆盖用户内容。
 */
export async function appendAllowRule(path: string, tool: string): Promise<void> {
  let document: Record<string, unknown> = {};
  try {
    const raw = await readFile(path, "utf8");
    parseSettings(path, raw);
    document = JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const permissions = isObject(document.permissions) ? { ...document.permissions } : {};
  const rules = Array.isArray(permissions.rules) ? [...permissions.rules] : [];
  const exists = rules.some((rule) => isObject(rule) && rule.tool === tool && rule.decision === "allow" && rule.pattern === undefined);
  if (exists) return;
  rules.push({ tool, decision: "allow" });
  const next = { ...document, permissions: { ...permissions, rules } };
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await rename(temp, path);
}
