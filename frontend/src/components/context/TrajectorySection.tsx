import { useCallback, useState } from "react";

import type { RequestHeaderBody, Trajectory, TrajectoryItem, TrajectoryTurn } from "../../agent/runtime/types";
import { useI18n, type I18nKey } from "../../i18n";
import { Icon } from "../Icon";
import { ICONS } from "../iconMap";
import { CompactionDetail, HeaderDetail, ModelDetail, NoticeDetail, ToolDetail, UserDetail } from "./trajectory/Details";
import { durationOf, formatMs, summaryOf } from "./trajectory/format";
import { Timeline } from "./trajectory/Timeline";
import { useTrajectory } from "./trajectory/useTrajectory";

// 「轨迹」分区（SDD 21 §5.1、§7）：工具栏、等宽泳道时间线、按轮次分组的记录表与展开详情。

const rowId = (itemId: string) => `traj-row-${itemId}`;

type HeaderItem = Extract<TrajectoryItem, { kind: "header" }>;

/** 每轮的请求头项，以及按轮次顺序的上一条请求头全文（差异标签用）。 */
function headerIndex(trajectory: Trajectory) {
  const byTurn = new Map<number, HeaderItem>();
  const previous = new Map<string, RequestHeaderBody | undefined>();
  let last: RequestHeaderBody | undefined;
  for (const turn of trajectory.turns) {
    const header = turn.items.find((item): item is HeaderItem => item.kind === "header");
    if (!header) continue;
    byTurn.set(turn.index, header);
    previous.set(header.item_id, last);
    last = trajectory.headers[header.hash];
  }
  return { byTurn, previous };
}

function TurnHead({ turn, collapsed, onToggle }: { turn: TrajectoryTurn; collapsed: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  const title = turn.index === 0 ? t("traj_turn_pre") : t("traj_turn", { n: turn.index });
  const elapsed = turn.started_at !== undefined && turn.ended_at !== undefined ? formatMs(turn.ended_at - turn.started_at) : "";
  return (
    <button type="button" className="traj-turn-head" aria-expanded={!collapsed} onClick={onToggle}>
      <Icon icon={collapsed ? ICONS.chevronRight : ICONS.chevronDown} size="sm" />
      <b>{title}</b>
      {turn.started_at !== undefined && <span className="res-hint">{new Date(turn.started_at).toLocaleTimeString()}</span>}
      {elapsed && <span className="res-hint">{elapsed}</span>}
      {turn.index > 0 && <span className={`res-badge traj-outcome-${turn.outcome}`}>{t(`traj_outcome_${turn.outcome}` as I18nKey)}</span>}
    </button>
  );
}

export function TrajectorySection() {
  const { t } = useI18n();
  const { state, refresh, sessionId } = useTrajectory();
  const [collapsedTurns, setCollapsedTurns] = useState<ReadonlySet<number>>(new Set());
  const [callsCollapsed, setCallsCollapsed] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const data = state.status === "ready" || state.status === "loading" ? state.data : undefined;

  const toggle = <T,>(set: ReadonlySet<T>, value: T): Set<T> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  /** 时间线与「见第 N 轮上下文」跳转：展开所在轮次与该行，滚动到可见（§7.5 规则 3）。 */
  const jump = useCallback((item: TrajectoryItem) => {
    const turn = data?.turns.find((candidate) => candidate.items.some((other) => other.item_id === item.item_id));
    if (turn) setCollapsedTurns((prev) => { const next = new Set(prev); next.delete(turn.index); return next; });
    if (item.kind === "tool") setCallsCollapsed(false);
    setExpanded((prev) => new Set(prev).add(item.item_id));
    requestAnimationFrame(() => document.getElementById(rowId(item.item_id))?.scrollIntoView?.({ block: "nearest" }));
  }, [data]);

  if (state.status === "no-session") return <div className="ctx-section"><div className="res-empty">{t("traj_no_session")}</div></div>;

  const allCollapsed = !!data && data.turns.length > 0 && data.turns.every((turn) => collapsedTurns.has(turn.index));
  const headers = data ? headerIndex(data) : undefined;

  const detail = (turn: TrajectoryTurn, item: TrajectoryItem) => {
    switch (item.kind) {
      case "header":
        return <HeaderDetail item={item} body={data!.headers[item.hash]} previous={headers?.previous.get(item.item_id)} />;
      case "model": {
        const header = headers?.byTurn.get(turn.index);
        return (
          <ModelDetail
            item={item}
            sessionId={sessionId!}
            {...(header ? { contextWindow: header.context_window, headerTurn: turn.index, onJumpHeader: () => jump(header) } : {})}
          />
        );
      }
      case "tool":
        return <ToolDetail item={item} />;
      case "compaction":
        return <CompactionDetail item={item} />;
      case "user":
        return <UserDetail item={item} />;
      case "notice":
        return <NoticeDetail item={item} />;
    }
  };

  return (
    <section className="ctx-section traj" data-testid="ctx-trajectory">
      <div className="res-actions traj-toolbar">
        <button type="button" disabled={state.status === "loading"} onClick={() => void refresh()}>
          <Icon icon={ICONS.regenerate} size="sm" /> {t("ctx_preview_refresh")}
        </button>
        <button
          type="button"
          aria-pressed={allCollapsed}
          disabled={!data?.turns.length}
          onClick={() => setCollapsedTurns(allCollapsed ? new Set() : new Set(data!.turns.map((turn) => turn.index)))}
        >
          {t("traj_turns_toggle")}
        </button>
        <button type="button" aria-pressed={callsCollapsed} disabled={!data?.turns.length} onClick={() => setCallsCollapsed((v) => !v)}>
          {t("traj_calls_toggle")}
        </button>
      </div>
      {state.status === "error" && <div className="res-error" role="alert">{state.error}</div>}
      {state.status === "outdated" && <div className="res-error" role="alert">{t("ctx_preview_outdated")}</div>}
      {state.status === "loading" && !data && <div className="res-empty" aria-busy="true">{t("traj_loading")}</div>}
      {data && (
        <>
          <div className="ctx-totals" data-testid="traj-totals">
            {t("traj_totals", {
              turns: data.totals.turns,
              calls: data.totals.model_calls,
              tools: data.totals.tool_calls,
              input: data.totals.usage.input,
              output: data.totals.usage.output,
              cache: data.totals.usage.cache_read,
            })}
          </div>
          {!data.turns.length && <div className="res-empty">{t("traj_empty")}</div>}
          <Timeline trajectory={data} onJump={jump} />
          <ol className="traj-turns">
            {data.turns.map((turn) => {
              const collapsed = collapsedTurns.has(turn.index);
              const items = callsCollapsed ? turn.items.filter((item) => item.kind !== "tool") : turn.items;
              return (
                <li key={turn.index} className="traj-turn" data-turn={turn.index}>
                  <TurnHead turn={turn} collapsed={collapsed} onToggle={() => setCollapsedTurns((prev) => toggle(prev, turn.index))} />
                  {!collapsed && (
                    <ul className="traj-rows">
                      {items.map((item) => {
                        const open = expanded.has(item.item_id);
                        const duration = durationOf(item);
                        return (
                          <li key={item.item_id} id={rowId(item.item_id)} className={`traj-row traj-kind-${item.kind}`}>
                            <button
                              type="button"
                              className="traj-row-head"
                              aria-expanded={open}
                              onClick={() => setExpanded((prev) => toggle(prev, item.item_id))}
                            >
                              <span className={`traj-badge traj-badge-${item.kind}`}>{t(`traj_kind_${item.kind}` as I18nKey)}</span>
                              <span className="traj-summary">{summaryOf(t, item, data.headers)}</span>
                              {item.kind === "tool" && item.blocked && <span className="res-badge traj-blocked">{t("traj_tool_blocked")}</span>}
                              {duration && <span className="traj-duration mono">{duration}</span>}
                            </button>
                            {open && detail(turn, item)}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
