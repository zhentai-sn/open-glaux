/** SDD 15 §7.4、§7.5：权限模式表与判定顺序（越界之后的第 2～5 步）。纯函数，便于穷举测试。 */
import type { PermissionMode } from "../contracts.js";
import type { ToolEffect } from "../plugins/types.js";

export type Decision = "allow" | "deny" | "ask";

export interface PermissionRule {
  tool: string;
  pattern?: string;
  decision: Decision;
}

/** §7.4「不挂载」：命令开始时按模式过滤，模型看不到这些工具。 */
export function mountable(effect: ToolEffect, mode: PermissionMode): boolean {
  if (mode === "observe") return effect === "read";
  // controlled 也挂载 exec，但只放行只读调用（SDD 16 §7.5 规则 6）
  if (effect === "exec") return mode === "controlled" || mode === "autonomous";
  return true;
}

/**
 * §7.4 模式默认：自动放行或需审批。`sensitive` 表示路径在工作目录之外或隐藏（SDD 16 §7.2），
 * 只对 `read` / `write` 有意义：非 `autonomous` 一律审批。`readOnly` 只对 `exec` 有意义：
 * controlled 下只读调用放行，其余拒绝。
 */
export function modeDefault(effect: ToolEffect, mode: PermissionMode, sensitive = false, readOnly = false): Decision {
  if (!mountable(effect, mode)) return "deny";
  if (mode === "autonomous") return "allow";
  if (effect === "exec") return readOnly ? "allow" : "deny";
  if (sensitive && (effect === "read" || effect === "write")) return "ask";
  if (effect === "read") return "allow";
  if (mode === "observe") return "deny";
  if (mode === "suggest") return effect === "annotate" ? "allow" : "ask";
  return "allow";
}

/** glob 只支持 `*`（不跨 `/`）与 `**`（跨 `/`）；`bash` 的命令按前缀匹配由工具自己给出 subject。 */
export function globMatch(pattern: string, subject: string): boolean {
  const source = pattern
    .split("**")
    .map((part) => part.split("*").map((piece) => piece.replace(/[.+?^${}()|[\]\\]/gu, "\\$&")).join("[^/]*"))
    .join(".*");
  return new RegExp(`^${source}$`, "u").test(subject);
}

export type PatternMatcher = (pattern: string, subject: string) => boolean;

export function ruleMatches(
  rule: PermissionRule, tool: string, subject: string | undefined, match: PatternMatcher = globMatch,
): boolean {
  if (rule.tool !== "*" && rule.tool !== tool) return false;
  if (rule.pattern === undefined) return true;
  return subject !== undefined && match(rule.pattern, subject);
}

export interface DecideInput {
  tool: string;
  effect: ToolEffect;
  mode: PermissionMode;
  rules: readonly PermissionRule[];
  /** 本会话「本会话允许」过的工具名。 */
  grants: ReadonlySet<string>;
  subject?: string;
  /** 路径在工作目录之外或隐藏（SDD 16 §7.2）。 */
  sensitive?: boolean;
  /** 工具自带的 pattern 匹配方式（如 `bash` 前缀匹配）；缺省为 glob。 */
  match?: PatternMatcher;
  /** `exec` 调用只读（SDD 16 §7.5 规则 6）。 */
  readOnly?: boolean;
}

export interface Verdict {
  decision: Decision;
  basis: "rule" | "grant" | "mode";
  rule?: PermissionRule;
}

/**
 * deny 规则 → ask 规则 → allow 规则或会话授权 → 模式默认，命中即停（SDD 15 D-3）。
 * 敏感路径只认带 pattern 的 allow 规则，不认会话授权（SDD 16 §7.2 规则 7）。
 */
export function decide(input: DecideInput): Verdict {
  if (!mountable(input.effect, input.mode)) return { decision: "deny", basis: "mode" };
  // controlled 下非只读的 exec 一律拒绝：allow 规则与会话授权都不能越过（SDD 16 §7.5 规则 6）
  if (input.effect === "exec" && input.mode === "controlled" && !input.readOnly) return { decision: "deny", basis: "mode" };
  const matching = input.rules.filter((rule) => ruleMatches(rule, input.tool, input.subject, input.match));
  for (const decision of ["deny", "ask"] as const) {
    const rule = matching.find((candidate) => candidate.decision === decision);
    if (rule) return { decision, basis: "rule", rule };
  }
  const allowRule = matching.find((rule) => rule.decision === "allow" && (!input.sensitive || rule.pattern !== undefined));
  if (allowRule) return { decision: "allow", basis: "rule", rule: allowRule };
  if (!input.sensitive && input.grants.has(input.tool)) return { decision: "allow", basis: "grant" };
  return { decision: modeDefault(input.effect, input.mode, input.sensitive, input.readOnly), basis: "mode" };
}
