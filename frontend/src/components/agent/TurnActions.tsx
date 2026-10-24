import { useState } from "react";

import type { TurnStats } from "../../agent/runtime/types";
import { useI18n } from "../../i18n";
import { useSession } from "../../store/session";
import { useContextSection } from "../../store/contextSection";
import { Icon } from "../Icon";
import { ICONS } from "../iconMap";
import { ComposerPopover } from "./ComposerPopover";
import { exactTokens, percentText } from "./usageFormat";

/** 本轮用量的弹层内容（对齐 DSH 的「本轮用量」）：总量、提供方/模型、缓存与输入输出。 */
function TurnUsagePanel({ turn }: { turn: TurnStats }) {
  const { t } = useI18n();
  const usage = turn.usage;
  const total = usage.input + usage.cacheRead + usage.cacheWrite + usage.output;
  const cachedInput = usage.input + usage.cacheRead;
  const rows = [
    { label: t("agent_turn_provider"), value: turn.provider && turn.model ? `${turn.provider}/${turn.model}` : turn.model ?? "—" },
    { label: t("agent_stats_cache_hit"), value: cachedInput > 0 ? percentText(usage.cacheRead / cachedInput) : "—" },
    { label: t("agent_stats_uncached_input"), value: `${exactTokens(usage.input)} tok` },
    { label: t("agent_stats_cache_read"), value: `${exactTokens(usage.cacheRead)} tok` },
    { label: t("agent_stats_output"), value: `${exactTokens(usage.output)} tok` },
  ];
  return (
    <div className="turn-usage">
      <div className="turn-usage-head">
        <span>{t("agent_turn_usage")}</span>
        <b>{exactTokens(total)} tok</b>
      </div>
      <dl className="turn-usage-grid">
        {rows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

interface TurnActionsProps {
  /** 本轮回答正文（复制用）。 */
  text: string;
  /** 本轮用量；旧数据没有轮次统计时为 null。 */
  turn: TurnStats | null;
  /** 轨迹里的轮次号（1 起）；null 表示不可定位。 */
  turnIndex: number | null;
  /** 本轮结束时间（epoch 毫秒），显示成 HH:MM。 */
  endedAt: number | null;
}

/**
 * 轮次下方的操作行（对齐 DSH）：复制、赞/踩（本地）、在上下文视图中定位此轮、本轮用量、时间戳。
 * 赞踩只落本地状态——没有回写后端，不假装有反馈回路。
 */
export function TurnActions({ text, turn, turnIndex, endedAt }: TurnActionsProps) {
  const { t } = useI18n();
  const notify = useSession((state) => state.notify);
  const [vote, setVote] = useState<"up" | "down" | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      notify("info", t("agent_copied_message"));
    } catch {
      notify("crit", t("agent_copy_failed"));
    }
  };

  const locate = () => {
    if (turnIndex === null) return;
    const state = useSession.getState();
    useContextSection.getState().setSection("trajectory");
    useContextSection.getState().setFocusTurn(turnIndex);
    if (state.uiMode === "focus") state.setFocusLayout({ rightOpen: true, sideView: "context" });
    else state.setSidebarView("context");
  };

  const total = turn
    ? turn.usage.input + turn.usage.cacheRead + turn.usage.cacheWrite + turn.usage.output
    : null;

  return (
    <div className="turn-actions">
      <button type="button" className="turn-action" title={t("agent_copy_message")} aria-label={t("agent_copy_message")} onClick={() => void copy()}>
        <Icon icon={ICONS.copy} size="sm" />
      </button>
      <button
        type="button"
        className="turn-action"
        aria-pressed={vote === "up"}
        title={t("agent_vote_up")}
        aria-label={t("agent_vote_up")}
        onClick={() => setVote((current) => (current === "up" ? null : "up"))}
      >
        <Icon icon={ICONS.thumbUp} size="sm" />
      </button>
      <button
        type="button"
        className="turn-action"
        aria-pressed={vote === "down"}
        title={t("agent_vote_down")}
        aria-label={t("agent_vote_down")}
        onClick={() => setVote((current) => (current === "down" ? null : "down"))}
      >
        <Icon icon={ICONS.thumbDown} size="sm" />
      </button>
      <button
        type="button"
        className="turn-action"
        title={t("agent_view_in_context")}
        aria-label={t("agent_view_in_context")}
        disabled={turnIndex === null}
        onClick={locate}
      >
        <Icon icon={ICONS.locate} size="sm" />
      </button>
      {turn && total !== null && (
        <ComposerPopover
          label={t("agent_turn_usage")}
          icon={<Icon icon={ICONS.usage} size="sm" />}
          text={t("agent_turn_usage_total", {
            // 不足百万给精确数字，多了才收成 M，别把 5.3k 写成 0.0M
            n: total >= 1_000_000 ? `${(total / 1_000_000).toFixed(1)}M` : exactTokens(total),
          })}
          chevron={false}
          width={300}
          className="composer-pop--usage"
        >
          {() => <TurnUsagePanel turn={turn} />}
        </ComposerPopover>
      )}
      {endedAt !== null && (
        <time className="turn-time" dateTime={new Date(endedAt).toISOString()}>
          {new Date(endedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
        </time>
      )}
    </div>
  );
}
