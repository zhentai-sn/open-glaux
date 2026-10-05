/**
 * SDD 20：模型可见文本（系统提示词与工具定义）的语言。缺省英文，英文文本与 SDD 20 之前逐字一致。
 */
export const PROMPT_LANGS = ["en", "zh"] as const;
export type PromptLang = (typeof PROMPT_LANGS)[number];

/** 双语文案；缺任一语言即编译失败（SDD 20 §9）。 */
export type Bilingual = Readonly<Record<PromptLang, string>>;

export function isPromptLang(value: unknown): value is PromptLang {
  return (PROMPT_LANGS as readonly unknown[]).includes(value);
}

/** 上下文中的语言；未指定时为英文。 */
export function langOf(ctx: { lang?: PromptLang } | undefined): PromptLang {
  return ctx?.lang ?? "en";
}

type SchemaNode = Record<PropertyKey, unknown>;

function isNode(value: unknown): value is SchemaNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 遍历 schema 中的子节点：属性记为 `a.b`，数组元素记为 `a[]`，`anyOf` 等分支记为 `a|0`；根为空串。
 * 返回替换后的节点（`map` 不改动时原样返回）。
 */
function walk(node: SchemaNode, path: string, visit: (node: SchemaNode, path: string) => SchemaNode): SchemaNode {
  let next = visit(node, path);
  const child = (key: string) => (path ? `${path}.${key}` : key);
  if (isNode(next.properties)) {
    const properties = Object.fromEntries(Object.entries(next.properties).map(([key, value]) =>
      [key, isNode(value) ? walk(value, child(key), visit) : value]));
    next = { ...next, properties };
  }
  if (isNode(next.items)) next = { ...next, items: walk(next.items, `${path}[]`, visit) };
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    const branches = next[key];
    if (Array.isArray(branches)) {
      next = { ...next, [key]: branches.map((branch, i) => (isNode(branch) ? walk(branch, `${path}|${i}`, visit) : branch)) };
    }
  }
  return next;
}

/** schema 中所有带 `description` 的节点路径。 */
export function schemaDescriptionPaths(schema: object): string[] {
  const paths: string[] = [];
  walk(schema as SchemaNode, "", (node, path) => {
    if (typeof node.description === "string") paths.push(path);
    return node;
  });
  return paths;
}

const localized = new WeakMap<object, WeakMap<object, unknown>>();

/**
 * 复制 schema 并按路径替换 `description`（SDD 20 §7.3）。对象展开会保留 TypeBox 的 symbol 元数据，
 * 结构与校验行为不变。带说明的节点缺译文、或译文指向不存在的路径时抛错，保证双语齐全。
 */
export function localizeSchema<T extends object>(schema: T, descriptions: Readonly<Record<string, string>>): T {
  const cached = localized.get(schema)?.get(descriptions);
  if (cached) return cached as T;
  const used = new Set<string>();
  const result = walk(schema as SchemaNode, "", (node, path) => {
    if (typeof node.description !== "string") return node;
    const text = descriptions[path];
    if (text === undefined) throw new Error(`Missing translated description for schema path "${path}".`);
    used.add(path);
    return { ...node, description: text };
  });
  const unknown = Object.keys(descriptions).filter((path) => !used.has(path));
  if (unknown.length) throw new Error(`Translated descriptions for unknown schema paths: ${unknown.join(", ")}.`);
  const perSchema = localized.get(schema) ?? new WeakMap<object, unknown>();
  perSchema.set(descriptions, result);
  localized.set(schema, perSchema);
  return result as T;
}

/** 按语言取 schema：英文返回原 schema，中文返回替换说明后的副本。 */
export function schemaFor<T extends object>(lang: PromptLang, schema: T, zh: Readonly<Record<string, string>>): T {
  return lang === "en" ? schema : localizeSchema(schema, zh);
}

/** 工具的中文定义：说明与参数说明（按 schema 路径）；没有参数说明的工具传 `{}`。 */
export interface ToolZh {
  description: string;
  parameters: Readonly<Record<string, string>>;
}

/** 按语言换上工具说明与参数说明（SDD 20 §7.3 规则 1）；英文原样返回。 */
export function localizeTool<T extends { description: string; parameters: object }>(tool: T, lang: PromptLang, zh: ToolZh): T {
  if (lang === "en") return tool;
  return { ...tool, description: zh.description, parameters: localizeSchema(tool.parameters, zh.parameters) };
}
