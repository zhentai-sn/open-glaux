/**
 * SDD 17 §7.1、§7.2：每个命令开始时加载 Skills、提示词模板与自定义说明。
 * 同名按 项目 > 用户 > 内置 取一份；停用的 Skill 不交给 harness；说明单份超过 32 KiB 截断。
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  formatSkillsForSystemPrompt,
  loadSourcedPromptTemplates,
  loadSourcedSkills,
  type PromptTemplate,
  type Skill,
} from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";

import { resourceDirs, type ResourceSource } from "./paths.js";

export interface SkillItem {
  name: string;
  description: string;
  source: ResourceSource;
  path: string;
  enabled: boolean;
  model_invocable: boolean;
  overridden_by?: ResourceSource;
}

export interface TemplateItem {
  name: string;
  description?: string;
  source: "user" | "project";
  path: string;
  overridden_by?: "project";
}

export interface InstructionsItem {
  scope: "user" | "project";
  path: string;
  exists: boolean;
  bytes: number;
}

export interface ResourceDiagnostic {
  source: ResourceSource;
  code: string;
  message: string;
  path: string;
}

export interface LoadedResources {
  skills: SkillItem[];
  templates: TemplateItem[];
  instructions: InstructionsItem[];
  diagnostics: ResourceDiagnostic[];
  /** 交给 pi harness 的资源：已去掉被覆盖与停用的 Skill。 */
  harnessSkills: Skill[];
  harnessTemplates: PromptTemplate[];
  /** 系统提示词的说明段与 Skills 目录段；都为空时为空串。 */
  promptExtras: string;
  /** Skills 根目录：`read` 在其下只读放行（§7.3）。 */
  readableRoots: string[];
}

export const MAX_INSTRUCTIONS_BYTES = 32 * 1024;
const RANK: Record<ResourceSource, number> = { builtin: 1, user: 2, project: 3 };

export interface LoadResourcesOptions {
  projectDir?: string;
  env?: NodeJS.ProcessEnv;
  builtinSkillsDir?: string;
  /** 用户级设置中的停用列表。 */
  disabledSkills?: readonly string[];
}

async function readInstructions(path: string): Promise<{ text: string; bytes: number } | undefined> {
  const raw = await readFile(path).catch(() => undefined);
  if (!raw) return undefined;
  const bytes = raw.byteLength;
  const truncated = bytes > MAX_INSTRUCTIONS_BYTES;
  const text = new TextDecoder().decode(truncated ? raw.subarray(0, MAX_INSTRUCTIONS_BYTES) : raw).trim();
  if (!text) return { text: "", bytes };
  return { text: truncated ? `${text}\n[truncated: the file exceeds ${MAX_INSTRUCTIONS_BYTES} bytes]` : text, bytes };
}

export async function loadResources(options: LoadResourcesOptions = {}): Promise<LoadedResources> {
  const dirs = resourceDirs(options);
  const env = new NodeExecutionEnv({ cwd: "/" });
  const disabled = new Set(options.disabledSkills ?? []);

  const loadedSkills = await loadSourcedSkills(env, dirs.skills);
  const winner = new Map<string, { skill: Skill; source: ResourceSource }>();
  for (const entry of loadedSkills.skills) {
    const current = winner.get(entry.skill.name);
    if (!current || RANK[entry.source] > RANK[current.source]) winner.set(entry.skill.name, entry);
  }
  const skills: SkillItem[] = loadedSkills.skills.map(({ skill, source }) => {
    const top = winner.get(skill.name)!;
    return {
      name: skill.name,
      description: skill.description,
      source,
      path: skill.filePath,
      enabled: !disabled.has(skill.name),
      model_invocable: !skill.disableModelInvocation,
      ...(top.source !== source ? { overridden_by: top.source } : {}),
    };
  });
  const harnessSkills = [...winner.values()].filter(({ skill }) => !disabled.has(skill.name)).map(({ skill }) => skill);

  const loadedTemplates = await loadSourcedPromptTemplates(env, dirs.prompts);
  const templateWinner = new Map<string, { promptTemplate: PromptTemplate; source: "user" | "project" }>();
  for (const entry of loadedTemplates.promptTemplates) {
    const current = templateWinner.get(entry.promptTemplate.name);
    if (!current || entry.source === "project") templateWinner.set(entry.promptTemplate.name, entry);
  }
  const promptsDirOf = new Map(dirs.prompts.map((dir) => [dir.source, dir.path]));
  const templates: TemplateItem[] = loadedTemplates.promptTemplates.map(({ promptTemplate, source }) => ({
    name: promptTemplate.name,
    ...(promptTemplate.description ? { description: promptTemplate.description } : {}),
    source,
    path: join(promptsDirOf.get(source)!, `${promptTemplate.name}.md`),
    ...(templateWinner.get(promptTemplate.name)!.source !== source ? { overridden_by: "project" as const } : {}),
  }));

  const instructions: InstructionsItem[] = [];
  const blocks: string[] = [];
  for (const { scope, path } of dirs.instructions) {
    const read = await readInstructions(path);
    instructions.push({ scope, path, exists: !!read, bytes: read?.bytes ?? 0 });
    if (read?.text) blocks.push(`<instructions scope="${scope}">\n${read.text}\n</instructions>`);
  }
  const catalog = formatSkillsForSystemPrompt(harnessSkills);
  if (catalog) blocks.push(catalog);

  return {
    skills,
    templates,
    instructions,
    diagnostics: [
      ...loadedSkills.diagnostics.map((d) => ({ source: d.source, code: d.code, message: d.message, path: d.path })),
      ...loadedTemplates.diagnostics.map((d) => ({ source: d.source as ResourceSource, code: d.code, message: d.message, path: d.path })),
    ],
    harnessSkills,
    harnessTemplates: [...templateWinner.values()].map(({ promptTemplate }) => promptTemplate),
    promptExtras: blocks.join("\n\n"),
    readableRoots: dirs.skills.map((dir) => dir.path),
  };
}
