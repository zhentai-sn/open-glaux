import { useState } from "react";

import type { InteractionReply, InteractionRequest } from "../../agent/runtime/types";
import { useI18n } from "../../i18n";
import type { I18nKey } from "../../i18n/en";
import type { ResolvedInteraction } from "../../store/agentSessions";
import { Icon } from "../Icon";
import { ICONS } from "../iconMap";

// 会话内的交互卡片（SDD 15 §5.1、§7.6）：权限审批与 ask_user 提问共用一种卡片。
// 待决时给出动作；结束后折叠成一行结论。回复只经回调交给 store，卡片不直接请求 runtime。

const GRANT_LABEL: Record<"once" | "session" | "always", I18nKey> = {
  once: "interaction_allow_once",
  session: "interaction_allow_session",
  always: "interaction_allow_always",
};

/** SDD 18 §7.4：子智能体触发的请求标出来源。 */
function OriginLine({ request }: { request: InteractionRequest }) {
  const { t } = useI18n();
  if (!request.origin) return null;
  return (
    <div className="interaction-origin" data-testid="interaction-origin">
      <Icon icon={ICONS.subagent} size="sm" /> {t("interaction_origin", { task: request.origin.subagent })}
    </div>
  );
}

export function InteractionCard({
  request,
  onReply,
}: {
  request: InteractionRequest;
  /** 返回 `false` 表示回复没有送达，卡片恢复可点以便重试。 */
  onReply: (reply: InteractionReply) => void | Promise<boolean>;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [answer, setAnswer] = useState("");
  const [sent, setSent] = useState(false);
  const reply = (value: InteractionReply) => {
    setSent(true);
    void Promise.resolve(onReply(value)).then((delivered) => {
      if (delivered === false) setSent(false);
    });
  };

  if (request.kind === "permission" && request.permission) {
    const permission = request.permission;
    return (
      <div className="interaction-card pending" data-testid="interaction-card" role="group" aria-label={t("interaction_permission_title", { tool: permission.tool_name })}>
        <div className="interaction-head">
          <Icon icon={ICONS.config} size="sm" />
          <b>{t("interaction_permission_title", { tool: permission.tool_name })}</b>
          <span className="interaction-effect">{t(`interaction_effect_${permission.effect}`)}</span>
        </div>
        <OriginLine request={request} />
        {permission.args_summary && permission.args_summary !== "{}" && (
          <div className="interaction-args mono">{permission.args_summary}</div>
        )}
        <div className="interaction-actions">
          {permission.grant_options.map((option) => (
            <button
              key={option}
              type="button"
              className={option === "once" ? "btn-primary" : undefined}
              disabled={sent}
              data-testid={`interaction-${option}`}
              onClick={() => reply({ kind: "permission", decision: option })}
            >
              {t(GRANT_LABEL[option])}
            </button>
          ))}
          <input
            className="interaction-reason"
            value={reason}
            maxLength={500}
            placeholder={t("interaction_deny_reason")}
            aria-label={t("interaction_deny_reason")}
            disabled={sent}
            onChange={(event) => setReason(event.target.value)}
          />
          <button
            type="button"
            disabled={sent}
            data-testid="interaction-deny"
            onClick={() => reply({ kind: "permission", decision: "deny", ...(reason.trim() ? { reason: reason.trim() } : {}) })}
          >
            {t("interaction_deny")}
          </button>
        </div>
      </div>
    );
  }

  const question = request.question;
  if (!question) return null;
  const submitText = () => {
    if (answer.trim()) reply({ kind: "question", text: answer.trim() });
  };
  return (
    <div className="interaction-card pending" data-testid="interaction-card" role="group" aria-label={t("interaction_question_title")}>
      <div className="interaction-head">
        <Icon icon={ICONS.skill} size="sm" />
        <b>{t("interaction_question_title")}</b>
      </div>
      <OriginLine request={request} />
      <div className="interaction-question">{question.question}</div>
      {question.options.length > 0 && (
        <div className="interaction-actions">
          {question.options.map((option, index) => (
            <button
              key={`${index}-${option}`}
              type="button"
              disabled={sent}
              data-testid={`interaction-option-${index}`}
              onClick={() => reply({ kind: "question", option: index })}
            >
              {option}
            </button>
          ))}
        </div>
      )}
      {question.allow_free_text && (
        <form
          className="interaction-actions"
          onSubmit={(event) => {
            event.preventDefault();
            submitText();
          }}
        >
          <input
            className="interaction-answer"
            value={answer}
            maxLength={2000}
            placeholder={t("interaction_answer_placeholder")}
            aria-label={t("interaction_answer_placeholder")}
            disabled={sent}
            onChange={(event) => setAnswer(event.target.value)}
          />
          <button type="submit" className="btn-primary" disabled={sent || !answer.trim()}>
            {t("interaction_submit")}
          </button>
        </form>
      )}
    </div>
  );
}

/** 已结束的请求折叠成一行结论。 */
export function ResolvedInteractionLine({ item }: { item: ResolvedInteraction }) {
  const { t } = useI18n();
  const title = item.request.kind === "permission" && item.request.permission
    ? t("interaction_permission_title", { tool: item.request.permission.tool_name })
    : item.request.question?.question ?? t("interaction_question_title");
  let outcome: I18nKey;
  if (item.outcome === "expired") outcome = "interaction_outcome_expired";
  else if (item.outcome === "cancelled") outcome = "interaction_outcome_cancelled";
  else if (item.reply?.kind === "permission") outcome = item.reply.decision === "deny" ? "interaction_outcome_denied" : "interaction_outcome_allowed";
  // 在别处（另一个窗口）回复的权限请求，本端不知道结论，只标「已处理」。
  else if (item.request.kind === "permission") outcome = "interaction_outcome_handled";
  else outcome = "interaction_outcome_answered";
  return (
    <div className="interaction-resolved" data-testid="interaction-resolved">
      <span className="interaction-resolved-title">{title}</span>
      <span className={`interaction-outcome ${item.outcome}`}>{t(outcome)}</span>
    </div>
  );
}
