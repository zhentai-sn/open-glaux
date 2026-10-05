// 运行轨迹的展开详情（SDD 21 §7.4、§7.6）。
import { useEffect, useState, type ReactNode } from "react";

import { agentRuntimeApi } from "../../../agent/runtime/client";
import type {
  RequestContext,
  RequestHeaderBody,
  TrajectoryBlock,
  TrajectoryItem,
  TranscriptMessage,
} from "../../../agent/runtime/types";
import { useI18n, type I18nKey } from "../../../i18n";
import { errorText } from "../shared";
import { SegmentList, segmentLabel } from "../SystemSection";
import { headerDiff, isEmptyDiff } from "./diff";
import { formatMs, imageLabel, noticeText, type Translate } from "./format";

type ItemOf<K extends TrajectoryItem["kind"]> = Extract<TrajectoryItem, { kind: K }>;

function Tabs({ tabs, render }: { tabs: { id: string; label: I18nKey }[]; render: (id: string) => ReactNode }) {
  const { t } = useI18n();
  const [current, setCurrent] = useState(tabs[0]!.id);
  return (
    <div className="traj-detail">
      <div className="traj-tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === current}
            className={tab.id === current ? "on" : undefined}
            onClick={() => setCurrent(tab.id)}
          >
            {t(tab.label)}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="traj-panel">{render(current)}</div>
    </div>
  );
}

export function Blocks({ blocks }: { blocks: TrajectoryBlock[] }) {
  const { t } = useI18n();
  if (!blocks.length) return <div className="res-empty">{t("traj_model_empty")}</div>;
  return (
    <div className="traj-blocks">
      {blocks.map((block, index) => {
        if (block.type === "text") return <pre key={index} className="res-preview mono">{block.text}</pre>;
        if (block.type === "thinking") {
          return (
            <details key={index} className="traj-thinking">
              <summary>{t("traj_thinking")}</summary>
              <pre className="res-preview mono">{block.text}</pre>
            </details>
          );
        }
        if (block.type === "image") return <div key={index} className="res-hint">{imageLabel(t, block)}</div>;
        return (
          <pre key={index} className="res-preview mono">{`${block.name}(${JSON.stringify(block.arguments, null, 2)})`}</pre>
        );
      })}
    </div>
  );
}

function Json({ value }: { value: unknown }) {
  return <pre className="res-preview mono">{JSON.stringify(value, null, 2)}</pre>;
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="traj-facts">
      {rows.map(([label, value]) => (
        <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
      ))}
    </dl>
  );
}

// ---- header ----

function HeaderTools({ body }: { body: RequestHeaderBody }) {
  const { t } = useI18n();
  return (
    <ul className="ctx-tools">
      {body.tools.map((tool) => (
        <li key={tool.name} className="ctx-tool">
          <details>
            <summary className="ctx-tool-head">
              <span className="res-item-name">{tool.name}</span>
              <span className="ctx-tokens">{t("ctx_tokens", { n: tool.est_tokens })}</span>
            </summary>
            <div className="ctx-tool-def">
              <pre className="res-preview mono">{tool.description}</pre>
              <Json value={tool.parameters} />
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}

function HeaderDiffView({ previous, body }: { previous?: RequestHeaderBody; body: RequestHeaderBody }) {
  const { t } = useI18n();
  if (!previous) return <div className="res-empty">{t("traj_diff_no_prev")}</div>;
  const diff = headerDiff(previous, body);
  if (isEmptyDiff(diff)) return <div className="res-empty">{t("traj_diff_same")}</div>;
  const sign = (n: number) => (n > 0 ? `+${n}` : String(n));
  const toolRows: [I18nKey, string[]][] = [
    ["traj_diff_added", diff.tools.added],
    ["traj_diff_removed", diff.tools.removed],
    ["traj_diff_changed", diff.tools.changed],
  ];
  return (
    <div className="traj-diff" data-testid="traj-diff">
      {diff.segments.length > 0 && (
        <section className="res-group">
          <div className="res-group-head">{t("traj_diff_segments")}</div>
          <ul className="traj-list">
            {diff.segments.map((change, index) => (
              <li key={index} className={`traj-diff-${change.status}`}>
                <span className="res-badge">{t(`traj_diff_${change.status}` as I18nKey)}</span> {segmentLabel(t, change.segment)}
                <span className="ctx-tokens">{t("ctx_tokens", { n: sign(change.delta) })}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {toolRows.some(([, names]) => names.length > 0) && (
        <section className="res-group">
          <div className="res-group-head">{t("traj_diff_tools")}</div>
          <ul className="traj-list">
            {toolRows.filter(([, names]) => names.length).map(([label, names]) => (
              <li key={label}><span className="res-badge">{t(label)}</span> <span className="mono">{names.join(", ")}</span></li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function HeaderDetail({ item, body, previous }: { item: ItemOf<"header">; body?: RequestHeaderBody; previous?: RequestHeaderBody }) {
  const { t } = useI18n();
  if (!body) return <div className="res-empty">{t("traj_header_missing")}</div>;
  return (
    <Tabs
      tabs={[{ id: "segments", label: "traj_tab_segments" }, { id: "tools", label: "traj_tab_tools" }, { id: "diff", label: "traj_tab_diff" }]}
      render={(id) => {
        if (id === "segments") {
          return (
            <>
              <div className="ctx-totals">
                {`${item.provider} / ${item.model} · ${item.lang} · ${item.permission_mode || "—"} · `}
                {t("ctx_tokens_total", { prompt: body.est_tokens.prompt, tools: body.est_tokens.tools, total: body.est_tokens.prompt + body.est_tokens.tools })}
              </div>
              <SegmentList segments={body.segments} />
            </>
          );
        }
        if (id === "tools") return <HeaderTools body={body} />;
        return <HeaderDiffView previous={previous} body={body} />;
      }}
    />
  );
}

// ---- model ----

function RequestTab({ sessionId, item, headerTurn, onJumpHeader }: {
  sessionId: string;
  item: ItemOf<"model">;
  headerTurn?: number;
  onJumpHeader?: () => void;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<{ data?: RequestContext; error?: string }>({});
  useEffect(() => {
    let alive = true;
    agentRuntimeApi.getRequestContext(sessionId, item.item_id)
      .then((data) => alive && setState({ data }))
      .catch((err: unknown) => alive && setState({ error: errorText(err) }));
    return () => { alive = false; };
  }, [sessionId, item.item_id]);
  if (state.error) return <div className="res-error" role="alert">{state.error}</div>;
  const data = state.data;
  if (!data) return <div className="res-empty" aria-busy="true">{t("traj_request_loading")}</div>;
  return (
    <div className="traj-request" data-testid="traj-request">
      {!data.matched && (
        <div className="res-warning" role="status">
          {data.recorded_count === undefined
            ? t("traj_request_unrecorded")
            : t("traj_request_mismatch", { n: data.messages.length, m: data.recorded_count })}
        </div>
      )}
      {headerTurn !== undefined && (
        <button type="button" className="ctx-link" onClick={onJumpHeader}>{t("traj_request_header", { n: headerTurn })}</button>
      )}
      <ol className="traj-messages">
        {data.messages.map((message, index) => (
          <li key={index}>
            <div className="traj-message-head">
              <span className="res-badge">{t(`traj_role_${message.role}` as I18nKey)}</span>
              {message.marks.map((mark) => (
                <span key={mark} className={`res-badge traj-mark-${mark}`}>{t(mark === "pruned" ? "traj_mark_pruned" : "traj_mark_injected")}</span>
              ))}
              <span className="ctx-tokens">{t("ctx_tokens", { n: message.est_tokens })}</span>
            </div>
            <Blocks blocks={message.content} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function Occupancy({ item, contextWindow }: { item: ItemOf<"model">; contextWindow?: number }) {
  const { t } = useI18n();
  if (!item.request) return <div className="res-empty">{t("traj_occ_none")}</div>;
  const { system, tools, messages } = item.request.est_tokens;
  const total = system + tools + messages;
  const parts: [I18nKey, number][] = [["traj_occ_system", system], ["traj_occ_tools", tools], ["traj_occ_messages", messages]];
  return (
    <section className="res-group" aria-label={t("traj_occupancy")}>
      <div className="res-group-head">{t("traj_occupancy")}</div>
      <div className="traj-bar" aria-hidden="true">
        {parts.map(([key, n]) => <span key={key} className={`traj-bar-${key.slice(9)}`} style={{ flexGrow: n }} />)}
      </div>
      <Facts rows={parts.map(([key, n]) => [t(key), t("ctx_tokens", { n })])} />
      {contextWindow ? (
        <div className="ctx-totals">
          {t("traj_occ_total", { n: total, window: contextWindow, pct: Math.round((total / contextWindow) * 1000) / 10 })}
        </div>
      ) : null}
    </section>
  );
}

export function ModelDetail({ item, sessionId, contextWindow, headerTurn, onJumpHeader }: {
  item: ItemOf<"model">;
  sessionId: string;
  contextWindow?: number;
  headerTurn?: number;
  onJumpHeader?: () => void;
}) {
  const { t } = useI18n();
  return (
    <Tabs
      tabs={[
        { id: "output", label: "traj_tab_output" },
        { id: "request", label: "traj_tab_request" },
        { id: "usage", label: "traj_tab_usage" },
        { id: "timing", label: "traj_tab_timing" },
      ]}
      render={(id) => {
        if (id === "output") {
          return (
            <>
              {item.stop_reason && item.stop_reason !== "stop" && <div className="res-hint">{t("traj_stop_reason", { reason: item.stop_reason })}</div>}
              {item.error_message && <div className="res-error">{item.error_message}</div>}
              <Blocks blocks={item.content} />
            </>
          );
        }
        if (id === "request") return <RequestTab sessionId={sessionId} item={item} headerTurn={headerTurn} onJumpHeader={onJumpHeader} />;
        if (id === "usage") {
          const rows: [string, ReactNode][] = [
            [t("traj_usage_input"), item.usage.input],
            [t("traj_usage_output"), item.usage.output],
            [t("traj_usage_cache_read"), item.usage.cacheRead],
            [t("traj_usage_cache_write"), item.usage.cacheWrite],
            ...(item.usage.reasoning !== undefined ? [[t("traj_usage_reasoning"), item.usage.reasoning] as [string, ReactNode]] : []),
          ];
          return (
            <>
              <Facts rows={rows} />
              <Occupancy item={item} contextWindow={contextWindow} />
            </>
          );
        }
        return <ModelTiming t={t} item={item} />;
      }}
    />
  );
}

function ModelTiming({ t, item }: { t: Translate; item: ItemOf<"model"> }) {
  const timing = item.timing;
  if (!timing) return <div className="res-empty">{t("traj_timing_none")}</div>;
  const rows: [string, ReactNode][] = [];
  if (timing.first_token_ms !== undefined) {
    rows.push([t("traj_timing_ttft"), formatMs(timing.first_token_ms)]);
    rows.push([t("traj_timing_decode"), formatMs(timing.duration_ms - timing.first_token_ms)]);
  }
  rows.push([t("traj_timing_total"), formatMs(timing.duration_ms)]);
  return <Facts rows={rows} />;
}

// ---- tool ----

function Transcript({ messages }: { messages: TranscriptMessage[] }) {
  const { t } = useI18n();
  const toBlocks = (content: TranscriptMessage["content"]): TrajectoryBlock[] =>
    typeof content === "string"
      ? [{ type: "text", text: content }]
      : content.map((block): TrajectoryBlock => block.type === "image"
        ? { type: "image", mimeType: block.mimeType, bytes: 0 }
        : block.type === "toolCall"
          ? { type: "toolCall", id: block.id, name: block.name, arguments: block.arguments }
          : { type: "text", text: block.text });
  return (
    <ol className="traj-messages">
      {messages.map((message, index) => (
        <li key={index}>
          <div className="traj-message-head">
            <span className="res-badge">{t(`traj_role_${message.role}` as I18nKey)}</span>
            {message.role === "toolResult" && <span className="mono">{message.toolName}</span>}
          </div>
          <Blocks blocks={toBlocks(message.content)} />
        </li>
      ))}
    </ol>
  );
}

export function ToolDetail({ item }: { item: ItemOf<"tool"> }) {
  const { t } = useI18n();
  const tabs: { id: string; label: I18nKey }[] = [
    { id: "args", label: "traj_tab_args" },
    { id: "result", label: "traj_tab_result" },
    { id: "timing", label: "traj_tab_timing" },
    ...(item.subagent ? [{ id: "subagent", label: "traj_tab_subagent" as I18nKey }] : []),
  ];
  return (
    <Tabs
      tabs={tabs}
      render={(id) => {
        if (id === "args") return <Json value={item.arguments} />;
        if (id === "result") return <Blocks blocks={item.result} />;
        if (id === "subagent" && item.subagent) {
          return (
            <>
              <div className="ctx-totals">{`${item.subagent.subagent_type} · ${item.subagent.description} · ${item.subagent.outcome} · ${item.subagent.turns}`}</div>
              <Transcript messages={item.subagent.transcript} />
            </>
          );
        }
        if (item.duration_ms === undefined) return <div className="res-empty">{t("traj_timing_none")}</div>;
        return (
          <Facts rows={[
            [t("traj_timing_total"), formatMs(item.duration_ms)],
            ...(item.waited_ms ? [[t("traj_timing_waited"), formatMs(item.waited_ms)] as [string, ReactNode]] : []),
          ]} />
        );
      }}
    />
  );
}

// ---- compaction / user / notice ----

export function CompactionDetail({ item }: { item: ItemOf<"compaction"> }) {
  const { t } = useI18n();
  return (
    <Tabs
      tabs={[{ id: "summary", label: "traj_tab_summary" }, { id: "kept", label: "traj_tab_kept" }, { id: "compare", label: "traj_tab_compare" }]}
      render={(id) => {
        if (id === "summary") return <pre className="res-preview mono">{item.summary}</pre>;
        if (id === "kept") return <div className="ctx-totals">{t("traj_kept", { n: item.kept.count, tokens: item.kept.est_tokens })}</div>;
        return (
          <div className="ctx-totals">
            {t("traj_compare", {
              before: item.tokens_before,
              after: item.summary_est_tokens + item.kept.est_tokens,
              summary: item.summary_est_tokens,
              kept: item.kept.est_tokens,
            })}
          </div>
        );
      }}
    />
  );
}

export function UserDetail({ item }: { item: ItemOf<"user"> }) {
  return <div className="traj-detail"><Blocks blocks={item.content} /></div>;
}

export function NoticeDetail({ item }: { item: ItemOf<"notice"> }) {
  const { t } = useI18n();
  return (
    <div className="traj-detail">
      <div className="ctx-totals">{noticeText(t, item)}</div>
      <Json value={item.data} />
    </div>
  );
}
