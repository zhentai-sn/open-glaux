/**
 * SDD 15 §7.5：权限插件。每次 `tool_call` 依次判定项目越界、规则、会话授权、模式默认；
 * 需要审批时经交互请求表挂起，按用户回复放行或拦截。拦截理由以工具错误回给模型。
 */
import type { ToolCallEvent, ToolCallResult } from "@earendil-works/pi-agent-core";

import type { PermissionMode, ViewerContext } from "../contracts.js";
import type { InteractionTable } from "../interaction/table.js";
import type { GlauxPlugin, PluginTool, RunContext } from "../plugins/types.js";
import { redactText } from "../security/redact.js";
import { decide } from "./decide.js";
import { allRules, appendAllowRule, type LoadedSettings } from "./settings.js";

export const PERMISSION_DECISION_ENTRY = "glaux.permission.decision";
export const PERMISSION_GRANT_ENTRY = "glaux.permission.grant";

/** 越界判定所需的能力；生产实现为 `ProjectScope`（SDD 13 §7.8 规则 4）。 */
export interface ScopeChecker {
  targets(params: unknown): string[];
  assertInProject(objectId: string, signal?: AbortSignal): Promise<void>;
}

export interface PermissionRunState {
  /** 每次判定实时读取会话当前模式（D-4）。 */
  getMode(): PermissionMode;
  /** 插件登记表中的工具；不在表中的工具（测试注入）不做权限判定。 */
  tools: ReadonlyMap<string, PluginTool>;
  scope: ScopeChecker;
  settings: LoadedSettings;
  /** 「本会话允许」过的工具名；命令开始时从会话记录恢复。 */
  grants: Set<string>;
  interactions?: InteractionTable;
  audit(customType: string, data: unknown): Promise<void>;
  /** 「总是允许」写入的设置文件：绑定项目时为项目级，否则为用户级（D-11）。 */
  alwaysPath: string;
}

export interface PermissionDeps {
  projectScope?: (options: { projectId?: string; viewer?: ViewerContext }) => ScopeChecker;
  loadSettings?: (projectId?: string) => Promise<{ settings: LoadedSettings; alwaysPath: string }>;
}

const MAX_ARGS_SUMMARY = 500;

function summarize(input: Record<string, unknown>): string {
  const text = redactText(JSON.stringify(input ?? {}));
  return text.length > MAX_ARGS_SUMMARY ? `${text.slice(0, MAX_ARGS_SUMMARY - 1)}…` : text;
}

function block(reason: string): ToolCallResult {
  return { block: true, reason };
}

async function judge(event: ToolCallEvent, ctx: RunContext): Promise<ToolCallResult | undefined> {
  const state = ctx.permission;
  if (!state) return undefined;
  const tool = state.tools.get(event.toolName);
  if (!tool) return undefined;
  const record = (data: Record<string, unknown>) => state.audit(PERMISSION_DECISION_ENTRY, {
    tool_call_id: event.toolCallId, tool: tool.name, effect: tool.effect, ...data,
  }).catch(() => undefined);

  if (tool.projectScoped) {
    try {
      for (const objectId of state.scope.targets(event.input)) await state.scope.assertInProject(objectId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await record({ decision: "deny", basis: "project", reason });
      return block(reason);
    }
  }

  const mode = state.getMode();
  const subject = tool.permissionSubject?.(event.input);
  const verdict = decide({
    tool: tool.name, effect: tool.effect, mode, rules: allRules(state.settings), grants: state.grants,
    ...(subject !== undefined ? { subject } : {}),
  });
  if (verdict.decision === "allow") return undefined;
  if (verdict.decision === "deny") {
    const reason = verdict.basis === "rule"
      ? `The call to ${tool.name} was denied by a permission rule; it was not executed.`
      : `${tool.name} is not allowed in ${mode} mode; it was not executed.`;
    await record({ decision: "deny", basis: verdict.basis, mode, ...(verdict.rule ? { rule: verdict.rule } : {}) });
    return block(reason);
  }

  if (!state.interactions) {
    await record({ decision: "deny", basis: "approval_unavailable", mode });
    return block(`${tool.name} needs the user's approval, which is unavailable; it was not executed.`);
  }
  const resolution = await state.interactions.create({
    session_id: ctx.sessionId,
    command_id: ctx.commandId,
    kind: "permission",
    permission: {
      tool_call_id: event.toolCallId,
      tool_name: tool.name,
      effect: tool.effect,
      args_summary: summarize(event.input),
      grant_options: verdict.basis === "rule" ? ["once"] : ["once", "session", "always"],
    },
  });
  const reply = resolution.reply?.kind === "permission" ? resolution.reply : undefined;
  await record({
    decision: "ask", basis: verdict.basis, mode, outcome: resolution.outcome,
    ...(verdict.rule ? { rule: verdict.rule } : {}), ...(reply ? { reply: reply.decision } : {}),
  });
  if (resolution.outcome === "expired") return block(`The user did not approve ${tool.name} in time; it was not executed.`);
  if (resolution.outcome === "cancelled" || !reply) return block(`The approval for ${tool.name} was cancelled; it was not executed.`);
  if (reply.decision === "deny") {
    return block(`The user denied ${tool.name}${reply.reason ? `: ${reply.reason.replace(/[.。]$/u, "")}.` : "."} It was not executed.`);
  }
  if (reply.decision === "session" || reply.decision === "always") {
    state.grants.add(tool.name);
    if (reply.decision === "session") {
      await state.audit(PERMISSION_GRANT_ENTRY, { tool: tool.name }).catch(() => undefined);
    } else {
      try {
        await appendAllowRule(state.alwaysPath, tool.name);
      } catch (error) {
        // §13：写规则失败按「本会话允许」处理。
        await state.audit(PERMISSION_GRANT_ENTRY, { tool: tool.name }).catch(() => undefined);
        await record({ decision: "grant_fallback", path: state.alwaysPath, reason: (error as Error).message });
      }
    }
  }
  return undefined;
}

export const permissionPlugin: GlauxPlugin = {
  name: "permission",
  applies: () => true,
  hooks: { tool_call: judge },
};
