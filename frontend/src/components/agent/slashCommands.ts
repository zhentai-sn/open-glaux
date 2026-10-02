// SDD 17 §7.7：输入框 `/` 菜单与显式调用的解析；纯函数，便于单测。
import type { ResourceList } from "../../agent/runtime/types";

export type Invocation = { skill: string } | { template: { name: string; args: string } };

export interface SlashItem {
  kind: "skill" | "template";
  name: string;
  description: string;
}

/** 可显式调用的条目：启用且未被覆盖的 Skills 与未被覆盖的模板，按名称排序。 */
export function slashItems(list: ResourceList | null): SlashItem[] {
  if (!list) return [];
  const skills = list.skills
    .filter((skill) => skill.enabled && !skill.overridden_by)
    .map((skill): SlashItem => ({ kind: "skill", name: skill.name, description: skill.description }));
  const templates = list.templates
    .filter((template) => !template.overridden_by)
    .map((template): SlashItem => ({ kind: "template", name: template.name, description: template.description ?? "" }));
  return [...skills, ...templates].sort((a, b) => a.name.localeCompare(b.name));
}

/** 内容以 `/` 开头且还没打空白时返回正在输入的名称前缀，否则返回 null（菜单关闭）。 */
export function slashQuery(content: string): string | null {
  const match = /^\/([a-z0-9-]*)$/u.exec(content);
  return match ? match[1]! : null;
}

/** 发送时：`/名称 其余` 且名称命中条目 → 显式调用；否则按普通文本发送。 */
export function parseInvocation(content: string, items: SlashItem[]): { invocation: Invocation; rest: string } | null {
  const match = /^\/([a-z0-9-]+)(?:\s+([\s\S]*))?$/u.exec(content.trim());
  if (!match) return null;
  const item = items.find((candidate) => candidate.name === match[1]);
  if (!item) return null;
  const rest = (match[2] ?? "").trim();
  return item.kind === "skill"
    ? { invocation: { skill: item.name }, rest }
    : { invocation: { template: { name: item.name, args: rest } }, rest };
}

/** 调用 Skill 的用户消息（pi `formatSkillInvocation`）：取名称与附加说明，供紧凑显示。 */
export function parseSkillMessage(text: string): { name: string; extra: string } | null {
  const match = /^<skill name="([^"]+)"[^>]*>[\s\S]*?<\/skill>\s*([\s\S]*)$/u.exec(text);
  return match ? { name: match[1]!, extra: match[2]!.trim() } : null;
}
