/**
 * SDD 17 §7.1、§7.2：每个命令开始时加载 Skills、提示词模板与自定义说明。
 * 同名按 项目 > 用户 > 内置 取一份；停用的 Skill 不交给 harness；说明单份超过 32 KiB 截断。
 */
import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";

import {
  formatSkillsForSystemPrompt,
  loadSourcedPromptTemplates,
  loadSourcedSkills,
  type PromptTemplate,
  type Skill,
} from "@earendil-works/pi-agent-core";

import type { PromptLang } from "../i18n/prompt-lang.js";
import { loadAgents, type AgentDefinition, type AgentItem } from "./agents.js";
import { ResourceExecutionEnv } from "./execution-env.js";
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
  /** 子智能体定义（SDD 18 §4.1）；`harnessAgents` 为去掉被覆盖者后的可用定义。 */
  agents: AgentItem[];
  harnessAgents: AgentDefinition[];
  diagnostics: ResourceDiagnostic[];
  /** 交给 pi harness 的资源：已去掉被覆盖与停用的 Skill。 */
  harnessSkills: Skill[];
  harnessTemplates: PromptTemplate[];
  /** 系统提示词的说明段与 Skills 目录段；都为空时为空串。 */
  promptExtras: string;
  /** 同上，按段保留来源（SDD 19 §9.2）；`promptExtras` 即各段以空行连接。 */
  promptExtraParts: PromptExtraPart[];
  /** Skills 根目录：`read` 在其下只读放行（§7.3）。 */
  readableRoots: string[];
}

export type PromptExtraPart =
  | { kind: "instructions"; scope: "user" | "project"; text: string }
  | { kind: "skills"; text: string };

export const MAX_INSTRUCTIONS_BYTES = 32 * 1024;
const RANK: Record<ResourceSource, number> = { builtin: 1, user: 2, project: 3 };

export interface LoadResourcesOptions {
  projectDir?: string;
  env?: NodeJS.ProcessEnv;
  builtinSkillsDir?: string;
  builtinAgentsDir?: string;
  /** 用户级设置中的停用列表。 */
  disabledSkills?: readonly string[];
  /** 技能目录引导语、Skills 目录行与截断说明的语言（SDD 20 §7.2）；缺省英文。 */
  lang?: PromptLang;
}

async function readInstructions(path: string, lang: PromptLang): Promise<{ text: string; bytes: number } | undefined> {
  const raw = await readFile(path).catch(() => undefined);
  if (!raw) return undefined;
  const bytes = raw.byteLength;
  const truncated = bytes > MAX_INSTRUCTIONS_BYTES;
  const text = new TextDecoder().decode(truncated ? raw.subarray(0, MAX_INSTRUCTIONS_BYTES) : raw).trim();
  if (!text) return { text: "", bytes };
  const note = lang === "zh"
    ? `[已截断：文件超过 ${MAX_INSTRUCTIONS_BYTES} 字节]`
    : `[truncated: the file exceeds ${MAX_INSTRUCTIONS_BYTES} bytes]`;
  return { text: truncated ? `${text}\n${note}` : text, bytes };
}

const FOLDER_LABEL: Record<PromptLang, Record<ResourceSource, string>> = {
  en: { project: "project", user: "personal", builtin: "built-in (read-only)" },
  zh: { project: "项目", user: "个人", builtin: "内置（只读）" },
};

/** 按优先级从高到低列出 Skills 目录；未绑定项目时没有项目层。 */
function skillFoldersLine(dirs: { source: ResourceSource; path: string }[], lang: PromptLang): string {
  const sorted = [...dirs].sort((a, b) => RANK[b.source] - RANK[a.source]);
  const trim = (path: string) => path.replace(/[\\/]+$/u, "");
  if (lang === "zh") {
    const folders = sorted.map((dir) => `${FOLDER_LABEL.zh[dir.source]}：${trim(dir.path)}`).join("；");
    return `Skills 目录，按优先级从高到低（同名 Skill 以较高目录中的为准）：${folders}。` +
      "一个 Skill 是目录 <folder>/<name>/，其中包含 SKILL.md。";
  }
  const folders = sorted.map((dir) => `${FOLDER_LABEL.en[dir.source]}: ${trim(dir.path)}`).join("; ");
  return `Skill folders, highest priority first (a same-named skill in a higher folder wins): ${folders}. ` +
    "A skill is a folder <folder>/<name>/ containing SKILL.md.";
}

function escapeXml(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;").replace(/'/gu, "&apos;");
}

/**
 * 技能目录段（SDD 20 §7.2 规则 4）：英文沿用 pi 的 `formatSkillsForSystemPrompt`；中文生成同一 XML 结构，
 * 只替换引导语，名称、描述、路径按原文。
 */
export function formatSkillsCatalog(skills: readonly Skill[], lang: PromptLang): string {
  if (lang === "en") return formatSkillsForSystemPrompt([...skills]);
  const visible = skills.filter((skill) => !skill.disableModelInvocation);
  if (!visible.length) return "";
  const lines = [
    "以下 Skill 为特定任务提供专门的说明。",
    "任务与某个 Skill 的描述相符时，读取它的完整 Skill 文件。",
    "Skill 文件引用相对路径时，以该 Skill 的目录（SKILL.md 所在目录）为基准解析，并在工具命令中使用解析后的绝对路径。",
    "",
    "<available_skills>",
  ];
  for (const skill of visible) {
    lines.push("  <skill>");
    lines.push(`    <name>${escapeXml(skill.name)}</name>`);
    lines.push(`    <description>${escapeXml(skill.description)}</description>`);
    lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
    lines.push("  </skill>");
  }
  lines.push("</available_skills>");
  return lines.join("\n");
}

export async function loadResources(options: LoadResourcesOptions = {}): Promise<LoadedResources> {
  const dirs = resourceDirs(options);
  const env = new ResourceExecutionEnv({ cwd: "/" });
  const disabled = new Set(options.disabledSkills ?? []);
  const lang = options.lang ?? "en";

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
      path: normalize(skill.filePath),
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
  const parts: PromptExtraPart[] = [];
  for (const { scope, path } of dirs.instructions) {
    const read = await readInstructions(path, lang);
    instructions.push({ scope, path, exists: !!read, bytes: read?.bytes ?? 0 });
    if (read?.text) parts.push({ kind: "instructions", scope, text: `<instructions scope="${scope}">\n${read.text}\n</instructions>` });
  }
  const agents = await loadAgents(dirs.agents);
  const catalog = formatSkillsCatalog(harnessSkills, lang);
  // 目录段末尾列出各层 Skills 目录，模型新建或覆盖 Skill 时据此选位置（SDD 17 §7.2）。
  if (catalog) parts.push({ kind: "skills", text: `${catalog}\n${skillFoldersLine(dirs.skills, lang)}` });

  return {
    skills,
    templates,
    instructions,
    agents: agents.items,
    harnessAgents: agents.definitions,
    diagnostics: [
      ...agents.diagnostics,
      ...loadedSkills.diagnostics.map((d) => ({ source: d.source, code: d.code, message: d.message, path: normalize(d.path) })),
      ...loadedTemplates.diagnostics.map((d) => ({ source: d.source as ResourceSource, code: d.code, message: d.message, path: normalize(d.path) })),
    ],
    harnessSkills,
    harnessTemplates: [...templateWinner.values()].map(({ promptTemplate }) => promptTemplate),
    promptExtras: parts.map((part) => part.text).join("\n\n"),
    promptExtraParts: parts,
    readableRoots: dirs.skills.map((dir) => dir.path),
  };
}
