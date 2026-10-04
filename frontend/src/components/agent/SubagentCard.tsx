import { useState } from "react";

import type { TranscriptBlock, TranscriptMessage } from "../../agent/runtime/types";
import { useI18n } from "../../i18n";
import type { I18nKey } from "../../i18n/en";
import { Icon } from "../Icon";
import { ICONS } from "../iconMap";
import { Markdown } from "./Markdown";

// 子智能体卡片（SDD 18 §5.1）：定义名、任务概括、结局、回合数与最终回复；过程默认收起。
// 卡片随会话快照持久呈现（§7.3）。
export const SUBAGENT_RUN_KIND = "glaux.subagent_run";

type Outcome = "completed" | "budget_exceeded" | "aborted" | "failed";

export interface SubagentRunPayload {
  subagent_type: string;
  description: string;
  outcome: Outcome;
  turns: number;
  final: string;
  transcript: TranscriptMessage[];
}

const OUTCOMES: readonly Outcome[] = ["completed", "budget_exceeded", "aborted", "failed"];
const OUTCOME_LABEL: Record<Outcome, I18nKey> = {
  completed: "subagent_outcome_completed",
  budget_exceeded: "subagent_outcome_budget_exceeded",
  aborted: "subagent_outcome_aborted",
  failed: "subagent_outcome_failed",
};

/** 从工具结果 details 解析（SDD 18 §9.2）；形状不符返回 null。 */
export function parseSubagentRun(value: unknown): SubagentRunPayload | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.kind !== SUBAGENT_RUN_KIND || typeof v.subagent_type !== "string" || typeof v.description !== "string") return null;
  if (!OUTCOMES.includes(v.outcome as Outcome)) return null;
  return {
    subagent_type: v.subagent_type,
    description: v.description,
    outcome: v.outcome as Outcome,
    turns: typeof v.turns === "number" ? v.turns : 0,
    final: typeof v.final === "string" ? v.final : "",
    transcript: Array.isArray(v.transcript) ? (v.transcript as TranscriptMessage[]) : [],
  };
}

const blockText = (blocks: string | TranscriptBlock[]) =>
  typeof blocks === "string" ? blocks : blocks.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");

function StepLine({ message }: { message: TranscriptMessage }) {
  const { t } = useI18n();
  if (message.role === "toolResult") {
    return (
      <li className={"subagent-step tool-result" + (message.isError ? " error" : "")}>
        <span className="subagent-step-role">{message.toolName}</span>
        <span className="subagent-step-text">{blockText(message.content)}</span>
      </li>
    );
  }
  const calls = message.role === "assistant"
    ? message.content.flatMap((b) => (b.type === "toolCall" ? [b.name] : []))
    : [];
  const text = blockText(message.content);
  return (
    <li className={`subagent-step ${message.role}`}>
      <span className="subagent-step-role">{t(message.role === "user" ? "subagent_step_task" : "subagent_step_reply")}</span>
      <span className="subagent-step-text">
        {text}
        {calls.length > 0 && <span className="mono"> → {calls.join(", ")}</span>}
      </span>
    </li>
  );
}

/**
 * `collapsible`：卡片挂在步骤组的工具调用条目下时只显示标题行，点开再看最终回复与过程，
 * 避免长回复占满对话流（SDD 15 §5.1）。
 */
export function SubagentCard({ payload, collapsible = false }: { payload: SubagentRunPayload; collapsible?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(!collapsible);
  const head = (
    <>
      <Icon icon={collapsible ? (open ? ICONS.chevronDown : ICONS.chevronRight) : ICONS.subagent} size="sm" />
      <b>{payload.description}</b>
      <span className="subagent-type mono">{payload.subagent_type}</span>
      <span className={`subagent-outcome ${payload.outcome}`}>{t(OUTCOME_LABEL[payload.outcome])}</span>
      <span className="subagent-turns">{t("subagent_turns", { n: payload.turns })}</span>
    </>
  );
  return (
    <div className={`subagent-card ${payload.outcome}${collapsible ? " collapsible" : ""}`} data-testid="subagent-card" aria-label={t("subagent_label", { name: payload.subagent_type })}>
      {collapsible ? (
        <button type="button" className="subagent-head" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {head}
        </button>
      ) : (
        <div className="subagent-head">{head}</div>
      )}
      {open && <SubagentBody payload={payload} />}
    </div>
  );
}

function SubagentBody({ payload }: { payload: SubagentRunPayload }) {
  const { t } = useI18n();
  return (
    <>
      <div className="subagent-final">
        {payload.final ? <Markdown text={payload.final} /> : <span className="subagent-empty">{t("subagent_no_reply")}</span>}
      </div>
      {payload.transcript.length > 0 && (
        <details className="subagent-transcript">
          <summary>{t("subagent_transcript", { n: payload.transcript.length })}</summary>
          <ol>
            {payload.transcript.map((message, index) => <StepLine key={index} message={message} />)}
          </ol>
        </details>
      )}
    </>
  );
}
