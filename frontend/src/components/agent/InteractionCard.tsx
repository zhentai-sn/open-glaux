import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";

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

/** 有副作用的权限等级，标签用警示色。 */
const RISKY_EFFECTS = new Set(["write", "exec", "egress", "delegate"]);

/** 距过期的分钟数，每 30 秒刷新；时间无法解析时为 null。 */
function useMinutesLeft(expiresAt: string): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const expires = Date.parse(expiresAt);
  return Number.isNaN(expires) ? null : Math.max(0, Math.ceil((expires - now) / 60_000));
}

/** 卡片标题行：类型、标题与「运行已暂停 · N 分钟后过期」。 */
function CardHead({ request, icon, title }: { request: InteractionRequest; icon: LucideIcon; title: string }) {
  const { t } = useI18n();
  const minutes = useMinutesLeft(request.expires_at);
  return (
    <div className="interaction-head">
      <span className="interaction-icon"><Icon icon={icon} size="sm" /></span>
      <b className="interaction-title">{title}</b>
      <span className="interaction-status">
        {minutes === null ? t("interaction_paused") : t("interaction_paused_expires", { n: minutes })}
      </span>
    </div>
  );
}

const isEditable = (element: Element | null) =>
  element instanceof HTMLElement
  && (element.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName));

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
  const [otherOpen, setOtherOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const reply = (value: InteractionReply) => {
    setSent(true);
    void Promise.resolve(onReply(value)).then((delivered) => {
      if (delivered === false) setSent(false);
    });
  };
  // 提问卡片出现时，焦点不在输入框就移到卡片上，数字键即可作答；不抢正在输入的焦点
  const isQuestion = request.kind === "question" && Boolean(request.question);
  useEffect(() => {
    if (isQuestion && !isEditable(document.activeElement)) cardRef.current?.focus({ preventScroll: true });
  }, [isQuestion]);

  if (request.kind === "permission" && request.permission) {
    const permission = request.permission;
    const title = t("interaction_permission_title", { tool: permission.tool_name });
    const deny = () => reply({ kind: "permission", decision: "deny", ...(reason.trim() ? { reason: reason.trim() } : {}) });
    return (
      <div className="interaction-card" data-testid="interaction-card" role="group" aria-label={title}>
        <CardHead request={request} icon={ICONS.config} title={title} />
        <OriginLine request={request} />
        <div className="interaction-body">
          <span className={`interaction-effect${RISKY_EFFECTS.has(permission.effect) ? " risky" : ""}`}>
            {t(`interaction_effect_${permission.effect}`)}
          </span>
          {permission.args_summary && permission.args_summary !== "{}" && (
            <div className="interaction-args mono">{permission.args_summary}</div>
          )}
        </div>
        <div className="interaction-actions">
          {permission.grant_options.map((option) => (
            <button
              key={option}
              type="button"
              className={option === "once" ? "interaction-btn primary" : "interaction-btn"}
              disabled={sent}
              data-testid={`interaction-${option}`}
              onClick={() => reply({ kind: "permission", decision: option })}
            >
              {t(GRANT_LABEL[option])}
            </button>
          ))}
        </div>
        <form
          className="interaction-deny-row"
          onSubmit={(event) => {
            event.preventDefault();
            deny();
          }}
        >
          <input
            className="interaction-input"
            value={reason}
            maxLength={500}
            placeholder={t("interaction_deny_reason")}
            aria-label={t("interaction_deny_reason")}
            disabled={sent}
            onChange={(event) => setReason(event.target.value)}
          />
          <button type="submit" className="interaction-btn danger" disabled={sent} data-testid="interaction-deny">
            {t("interaction_deny")}
          </button>
        </form>
      </div>
    );
  }

  const question = request.question;
  if (!question) return null;
  const submitText = () => {
    if (answer.trim()) reply({ kind: "question", text: answer.trim() });
  };
  // 没有选项时直接给输入框；有选项时「其他回答」点开才出现
  const showInput = question.allow_free_text && (otherOpen || question.options.length === 0);
  return (
    <div
      ref={cardRef}
      className="interaction-card"
      data-testid="interaction-card"
      role="group"
      tabIndex={-1}
      aria-label={t("interaction_question_title")}
      onKeyDown={(event) => {
        if (sent || isEditable(event.target as Element) || event.altKey || event.ctrlKey || event.metaKey) return;
        const index = Number(event.key) - 1;
        if (Number.isInteger(index) && index >= 0 && index < question.options.length) {
          event.preventDefault();
          reply({ kind: "question", option: index });
        }
      }}
    >
      <CardHead request={request} icon={ICONS.skill} title={t("interaction_question_title")} />
      <OriginLine request={request} />
      <div className="interaction-question">{question.question}</div>
      <div className="interaction-options">
        {question.options.map((option, index) => (
          <button
            key={`${index}-${option}`}
            type="button"
            className="interaction-option"
            disabled={sent}
            data-testid={`interaction-option-${index}`}
            onClick={() => reply({ kind: "question", option: index })}
          >
            {index < 9 && <kbd className="interaction-key">{index + 1}</kbd>}
            <span className="interaction-option-text">{option}</span>
          </button>
        ))}
        {question.allow_free_text && !showInput && (
          <button
            type="button"
            className="interaction-option other"
            disabled={sent}
            data-testid="interaction-other"
            onClick={() => setOtherOpen(true)}
          >
            <span className="interaction-key"><Icon icon={ICONS.edit} size="sm" /></span>
            <span className="interaction-option-text">{t("interaction_other")}</span>
          </button>
        )}
        {showInput && (
          <form
            className="interaction-other-form"
            onSubmit={(event) => {
              event.preventDefault();
              submitText();
            }}
          >
            <input
              className="interaction-input"
              value={answer}
              maxLength={2000}
              autoFocus={otherOpen}
              placeholder={t("interaction_answer_placeholder")}
              aria-label={t("interaction_answer_placeholder")}
              disabled={sent}
              onChange={(event) => setAnswer(event.target.value)}
            />
            <button
              type="submit"
              className="interaction-send"
              disabled={sent || !answer.trim()}
              aria-label={t("interaction_submit")}
              title={t("interaction_submit")}
            >
              <Icon icon={ICONS.send} size="sm" />
            </button>
          </form>
        )}
      </div>
      {question.options.length > 0 && (
        <div className="interaction-hint">{t("interaction_keys_hint", { n: Math.min(question.options.length, 9) })}</div>
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
