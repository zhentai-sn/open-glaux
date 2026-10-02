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
  if (effect === "exec") return mode === "autonomous";
  return true;
}

/** §7.4 模式默认：自动放行或需审批。`outsideCwd` 只对 `write` 有意义。 */
export function modeDefault(effect: ToolEffect, mode: PermissionMode, outsideCwd = false): Decision {
  if (!mountable(effect, mode)) return "deny";
  if (mode === "autonomous") return "allow";
  if (effect === "read") return "allow";
  if (mode === "observe") return "deny";
  if (mode === "suggest") return effect === "annotate" ? "allow" : "ask";
  // controlled
  if (effect === "write") return outsideCwd ? "ask" : "allow";
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

export function ruleMatches(rule: PermissionRule, tool: string, subject: string | undefined): boolean {
  if (rule.tool !== "*" && rule.tool !== tool) return false;
  if (rule.pattern === undefined) return true;
  return subject !== undefined && globMatch(rule.pattern, subject);
}

export interface DecideInput {
  tool: string;
  effect: ToolEffect;
  mode: PermissionMode;
  rules: readonly PermissionRule[];
  /** 本会话「本会话允许」过的工具名。 */
  grants: ReadonlySet<string>;
  subject?: string;
  outsideCwd?: boolean;
}

export interface Verdict {
  decision: Decision;
  basis: "rule" | "grant" | "mode";
  rule?: PermissionRule;
}

/** deny 规则 → ask 规则 → allow 规则或会话授权 → 模式默认，命中即停（D-3）。 */
export function decide(input: DecideInput): Verdict {
  if (!mountable(input.effect, input.mode)) return { decision: "deny", basis: "mode" };
  const matching = input.rules.filter((rule) => ruleMatches(rule, input.tool, input.subject));
  for (const decision of ["deny", "ask"] as const) {
    const rule = matching.find((candidate) => candidate.decision === decision);
    if (rule) return { decision, basis: "rule", rule };
  }
  const allowRule = matching.find((rule) => rule.decision === "allow");
  if (allowRule) return { decision: "allow", basis: "rule", rule: allowRule };
  if (input.grants.has(input.tool)) return { decision: "allow", basis: "grant" };
  return { decision: modeDefault(input.effect, input.mode, input.outsideCwd), basis: "mode" };
}
