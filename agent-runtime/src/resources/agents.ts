/**
 * SDD 18 §4.1：子智能体定义。`<name>.md`，frontmatter 只识别 name、description、tools、max_turns（D-8）。
 */
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import type { ResourceDiagnostic } from "./load.js";
import type { ResourceSource } from "./paths.js";

export interface AgentDefinition {
  name: string;
  description: string;
  /** 允许的工具名；缺省为父会话可用的全部工具。 */
  tools?: string[];
  maxTurns: number;
  /** 工作说明（正文）。 */
  body: string;
  source: ResourceSource;
  path: string;
}

export interface AgentItem {
  name: string;
  description: string;
  source: ResourceSource;
  path: string;
  tools?: string[];
  max_turns: number;
  overridden_by?: ResourceSource;
}

export const DEFAULT_SUBAGENT_TURNS = 20;
const MAX_SUBAGENT_TURNS = 50;
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const RANK: Record<ResourceSource, number> = { builtin: 1, user: 2, project: 3 };

function unquote(value: string): string {
  const v = value.trim();
  return (v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")) ? v.slice(1, -1) : v;
}

/** 解析 frontmatter 的最小子集；结构不对时抛出带原因的 Error。 */
export function parseAgentFile(raw: string, path: string, source: ResourceSource): AgentDefinition {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u.exec(raw);
  if (!match) throw new Error("missing frontmatter");
  const fields: Record<string, string | string[]> = {};
  let listKey: string | undefined;
  for (const line of match[1]!.split(/\r?\n/u)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const item = /^\s+-\s+(.+)$/u.exec(line);
    if (item && listKey) {
      (fields[listKey] as string[]).push(unquote(item[1]!));
      continue;
    }
    const pair = /^([a-z_]+):\s*(.*)$/u.exec(line);
    if (!pair) throw new Error(`cannot parse line: ${line.trim()}`);
    const [, key, value] = pair as unknown as [string, string, string];
    listKey = undefined;
    if (value === "") {
      fields[key] = [];
      listKey = key;
    } else if (value.startsWith("[") && value.endsWith("]")) {
      fields[key] = value.slice(1, -1).split(",").map(unquote).filter(Boolean);
    } else {
      fields[key] = unquote(value);
    }
  }
  const name = fields.name;
  const description = fields.description;
  if (typeof name !== "string" || !NAME.test(name) || name.length > 64) throw new Error("name must use lowercase letters, digits and hyphens");
  if (name !== basename(path, ".md")) throw new Error(`name ${name} does not match the file name`);
  if (typeof description !== "string" || !description.trim() || description.length > 1024) throw new Error("description is required (at most 1024 characters)");
  const tools = fields.tools;
  if (tools !== undefined && !Array.isArray(tools)) throw new Error("tools must be a list");
  let maxTurns = DEFAULT_SUBAGENT_TURNS;
  if (fields.max_turns !== undefined) {
    const n = Number(fields.max_turns);
    if (!Number.isInteger(n) || n < 1 || n > MAX_SUBAGENT_TURNS) throw new Error(`max_turns must be an integer from 1 to ${MAX_SUBAGENT_TURNS}`);
    maxTurns = n;
  }
  return { name, description: description.trim(), ...(Array.isArray(tools) ? { tools } : {}), maxTurns, body: match[2]!.trim(), source, path };
}

export async function loadAgents(dirs: { source: ResourceSource; path: string }[]): Promise<{
  items: AgentItem[];
  definitions: AgentDefinition[];
  diagnostics: ResourceDiagnostic[];
}> {
  const all: AgentDefinition[] = [];
  const diagnostics: ResourceDiagnostic[] = [];
  for (const dir of dirs) {
    const entries = await readdir(dir.path).catch(() => [] as string[]);
    for (const entry of entries.filter((name) => name.endsWith(".md")).sort()) {
      const path = join(dir.path, entry);
      try {
        all.push(parseAgentFile(await readFile(path, "utf8"), path, dir.source));
      } catch (error) {
        diagnostics.push({ source: dir.source, code: "invalid_agent", message: (error as Error).message, path });
      }
    }
  }
  const winner = new Map<string, AgentDefinition>();
  for (const def of all) {
    const current = winner.get(def.name);
    if (!current || RANK[def.source] > RANK[current.source]) winner.set(def.name, def);
  }
  const items = all.map((def): AgentItem => ({
    name: def.name,
    description: def.description,
    source: def.source,
    path: def.path,
    ...(def.tools ? { tools: def.tools } : {}),
    max_turns: def.maxTurns,
    ...(winner.get(def.name)!.source !== def.source ? { overridden_by: winner.get(def.name)!.source } : {}),
  }));
  return { items, definitions: [...winner.values()], diagnostics };
}
