import type { SessionStats } from "../../agent/runtime/types";
import { useI18n } from "../../i18n";
import { compactExact, costText, durationText, estimateTokens, exactTokens, percentText } from "./usageFormat";

interface ContextUsagePanelProps {
  stats: SessionStats | null;
  /** 统计尚未到达时的消息估算（`context_usage.tokens`）。 */
  fallbackTokens: number | null;
  /** 统计未到达时回退到连接配置里的窗口。 */
  fallbackWindow: number | null;
}

/**
 * 上下文面板（SDD 21 §9.5）：分段条 + 三段明细 + 会话统计 + Token 用量。
 * 数字全部来自 runtime 的会话统计（估算值带 `~`），窗口未知时只给 tokens 不编百分比。
 */
export function ContextUsagePanel({ stats, fallbackTokens, fallbackWindow }: ContextUsagePanelProps) {
  const { t } = useI18n();
  const context = stats?.context ?? null;
  const system = context?.system ?? 0;
  const tools = context?.tools ?? 0;
  const messages = context?.messages ?? 0;
  const total = context?.tokens ?? fallbackTokens ?? 0;
  const window = context?.window ?? fallbackWindow;
  const ratio = window && window > 0 ? Math.min(1, total / window) : null;
  const parts = [
    { key: "system", label: t("agent_usage_system"), value: system },
    { key: "tools", label: t("agent_usage_tools"), value: tools },
    { key: "messages", label: t("agent_usage_messages"), value: messages },
  ] as const;
  const sum = system + tools + messages;
  const tps = stats?.output_tps ?? null;

  const usageRows = [
    { label: t("agent_stats_cost"), value: costText(stats?.usage.cost) ?? t("agent_stats_unpriced") },
    { label: t("agent_stats_cache_hit"), value: stats?.cache_hit_ratio != null ? percentText(stats.cache_hit_ratio) : "—" },
    { label: t("agent_stats_uncached_input"), value: stats ? exactTokens(stats.usage.input) : "—" },
    { label: t("agent_stats_cache_read"), value: stats ? exactTokens(stats.usage.cacheRead) : "—" },
    { label: t("agent_stats_output"), value: stats ? exactTokens(stats.usage.output) : "—" },
  ];
  const sessionRows = [
    { label: t("agent_stats_model_time"), value: stats ? durationText(stats.model_ms, t) : "—" },
    { label: t("agent_stats_tool_time"), value: stats ? durationText(stats.tool_ms, t) : "—" },
    {
      label: t("agent_stats_ttft"),
      value: stats?.first_token_avg_ms != null ? durationText(stats.first_token_avg_ms, t) : "—",
    },
    { label: t("agent_stats_tps"), value: tps != null ? `${Math.round(tps)} ${t("agent_stats_tps_unit")}` : "—" },
  ];

  return (
    <div className="usage-panel">
      <div className="usage-head">
        <span className="usage-head-label">{t("agent_usage_used")}</span>
        {ratio != null && <b className="usage-head-pct">{percentText(ratio)}</b>}
        <span className="usage-head-count">
          {window
            ? `${estimateTokens(total)} / ${compactExact(window)}`
            : estimateTokens(total)}
        </span>
      </div>

      <div
        className="usage-bar"
        role="img"
        aria-label={parts.map((part) => `${part.label} ${estimateTokens(part.value)}`).join(" · ")}
      >
        <div className="usage-bar-fill" style={{ width: `${(ratio ?? 1) * 100}%` }}>
          {parts.map((part) => (
            <span
              key={part.key}
              className={`usage-seg usage-seg-${part.key}`}
              style={{ flexGrow: sum > 0 ? part.value / sum : 0 }}
            />
          ))}
        </div>
      </div>

      <ul className="usage-legend">
        {parts.map((part) => (
          <li key={part.key}>
            <span className={`usage-dot usage-seg-${part.key}`} aria-hidden="true" />
            <span>{part.label}</span>
            <b>{estimateTokens(part.value)}</b>
          </li>
        ))}
      </ul>

      {!stats && <p className="usage-empty">{t("agent_stats_empty")}</p>}

      <div className="usage-section">
        <h4>{t("agent_stats_session")}</h4>
        <dl className="usage-grid">
          {sessionRows.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="usage-section">
        <h4>{t("agent_stats_usage")}</h4>
        <dl className="usage-grid">
          {usageRows.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
