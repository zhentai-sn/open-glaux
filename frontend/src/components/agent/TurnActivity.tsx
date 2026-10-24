import { useEffect, useRef, useState } from "react";

import {
  messageRole,
  messageToolCalls,
  messageToolResult,
  type MessageToolCall,
} from "../../agent/runtime/events";
import { useI18n, type I18nKey } from "../../i18n";

// 等待行（SDD 00 §5.1）：首 token 前、工具执行中、工具结束后等待续写时，
// 用一行文字说明智能体在做什么。只做信息，不做循环动画（纲领 G12/M4）。

export interface Activity {
  key: I18nKey;
  vars?: Record<string, string>;
}

/** 工具名 → 文案；带文件参数的三类单独处理。 */
const GENERIC: Record<string, I18nKey> = {
  bash: "agent_wait_bash",
  run_task: "agent_wait_task",
  consult_atlas: "agent_wait_atlas",
  agent: "agent_wait_subagent",
  ask_user: "agent_wait_user",
};

function baseName(path: string): string {
  const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return at === -1 ? path : path.slice(at + 1);
}

function fileOf(call: MessageToolCall): string | undefined {
  const value = call.arguments.path;
  return typeof value === "string" && value ? baseName(value) : undefined;
}

function fileActivity(call: MessageToolCall, key: I18nKey): Activity {
  const file = fileOf(call);
  return file
    ? { key, vars: { file } }
    : { key: "agent_wait_tool", vars: { tool: call.name } };
}

/**
 * 当前应显示的等待文案；不该显示时返回 null。
 * 有流式正文时让文字自己承担进度，不再重复一行。
 */
export function activityFor({
  messages,
  running,
  waitingOnUser,
  streamingText,
}: {
  messages: unknown[];
  running: boolean;
  waitingOnUser: boolean;
  streamingText: string;
}): Activity | null {
  if (!running || waitingOnUser || streamingText) return null;

  // 最近的工具调用：从后往前找最后一条带调用的 assistant 消息。
  let latest: MessageToolCall | null = null;
  for (let index = messages.length - 1; index >= 0 && latest === null; index -= 1) {
    if (messageRole(messages[index]) !== "assistant") continue;
    const calls = messageToolCalls(messages[index]);
    if (calls.length) latest = calls[calls.length - 1] ?? null;
  }
  if (!latest) return { key: "agent_wait_thinking" };
  const call = latest;

  // 调用已有结果、又没有流式正文：模型在组织下一段回答。
  const hasResult = messages.some((message) => messageToolResult(message)?.toolCallId === call.id);
  if (hasResult) return { key: "agent_wait_composing" };

  if (call.name === "read") return fileActivity(call, "agent_wait_reading");
  if (call.name === "write") return fileActivity(call, "agent_wait_writing");
  if (call.name === "edit") return fileActivity(call, "agent_wait_editing");

  const generic = GENERIC[call.name];
  if (generic) return { key: generic };
  return { key: "agent_wait_tool", vars: { tool: call.name } };
}

/** 等待行里的耗时：不足 1 分钟只给秒，之后给 m ss。 */
export function formatWait(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, "0")}s`;
}

export function TurnActivity({
  messages,
  running,
  waitingOnUser,
  streamingText,
  runKey,
}: {
  messages: unknown[];
  running: boolean;
  waitingOnUser: boolean;
  streamingText: string;
  /** 会话 id：切换会话时重新计时。 */
  runKey?: string | null;
}) {
  const { t } = useI18n();
  const activity = activityFor({ messages, running, waitingOnUser, streamingText });
  const startedAt = useRef<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const visible = activity !== null;

  // 切换会话重新计时；效果顺序保证先清空、再重新取起点。
  useEffect(() => {
    startedAt.current = null;
  }, [runKey]);

  // 计时从进入运行态开始，停止后清零。只有等待行可见时才走秒表，流式正文期间不空转。
  useEffect(() => {
    if (!running) {
      startedAt.current = null;
      setNow(Date.now());
      return;
    }
    if (startedAt.current === null) startedAt.current = Date.now();
    if (!visible) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running, runKey, visible]);

  if (!activity) return null;
  const elapsed = startedAt.current === null ? 0 : now - startedAt.current;
  const text = t(activity.key, activity.vars);

  return (
    <div className="turn-activity" role="status" aria-live="polite" data-testid="turn-activity">
      <span className="turn-activity-dot" aria-hidden="true" />
      <span className="turn-activity-text" key={text}>{text}</span>
      {elapsed >= 3000 && <span className="turn-activity-clock">{formatWait(elapsed)}</span>}
    </div>
  );
}
