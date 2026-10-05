import { CHAT_EDITION } from "../../edition";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  messageImages,
  messageRole,
  messageText,
  messageToolCalls,
  messageToolResult,
  messageToolResultDetails,
  type MessageToolCall,
  type MessageToolResult,
} from "../../agent/runtime/events";
import { useConversation } from "../../agent/useConversation";
import { useI18n } from "../../i18n";
import { useAgentSessions, type ResolvedInteraction, type SubagentProgress, type ToolTiming } from "../../store/agentSessions";
import { useProjects } from "../../store/projects";
import { activeObject, useSession } from "../../store/session";
import { Icon } from "../Icon";
import { ICONS } from "../iconMap";
import type { PermissionMode } from "../../agent/runtime/types";
import { AtlasRefCard, parseAtlasReferenced } from "./AtlasRefCard";
import { SuggestionCard, parseAnnotationProposed } from "./SuggestionCard";
import { ObjectCard, parseObjectOpened } from "./ObjectCard";
import { FileCard, parseFileRead } from "./FileCard";
import { SubagentCard, parseSubagentRun } from "./SubagentCard";
import { ConnectionConfig } from "./ConnectionConfig";
import { ConversationComposer } from "./ConversationComposer";
import { Markdown } from "./Markdown";
import { SessionDrawer } from "./SessionDrawer";
import { projectWritable } from "./sessionGroups";
import { OwlLogo } from "../OwlLogo";
import { VideoEvidenceCard } from "./VideoEvidenceCard";
import { InteractionCard, ResolvedInteractionLine } from "./InteractionCard";
import { parseSkillMessage } from "./slashCommands";

const PERMISSION_MODES: PermissionMode[] = [
  "observe",
  "suggest",
  "controlled",
  "autonomous",
];

/**
 * 耗时：快照里的 `duration_ms` 优先，运行中用 `tool.start` / `tool.end` 的到达时刻。
 * `ms` 扣除了等待用户回复（审批、`ask_user`）的时长，`waited` 单独给出。
 */
function toolDuration(
  result: MessageToolResult | undefined, timing: ToolTiming | undefined,
): { ms: number; waited: number } | undefined {
  const total = result?.durationMs ?? (timing?.endedAt !== undefined ? timing.endedAt - timing.startedAt : undefined);
  if (total === undefined) return undefined;
  const waited = (result ? result.waitedMs : timing?.waitedMs) ?? 0;
  return { ms: Math.max(0, total - waited), waited };
}

/** 等待用户回复本身就是交互，不进步骤组：提问卡片与回答后的结论行已呈现它。 */
const INTERACTIVE_TOOLS = new Set(["ask_user"]);
const isStepCall = (call: MessageToolCall) => !INTERACTIVE_TOOLS.has(call.name);

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

// 工具调用条目（SDD 15 §5.1）：标题行为工具名、入参摘要、耗时，点开看完整输入与输出；
// 产出卡片（文件、对象、子智能体等）挂在条目下方。run_task 的产出另经 toolBridge 写回查看器。
// 被拦截或失败的调用在标题行附理由。
function ToolCallItem({
  call,
  result,
  timing,
  error,
  progress,
  card,
  running,
}: {
  call: MessageToolCall;
  result?: MessageToolResult | undefined;
  timing?: ToolTiming | undefined;
  error?: string | undefined;
  progress?: SubagentProgress | undefined;
  card?: ReactNode;
  running: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const args = Object.entries(call.arguments)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("  ");
  const duration = toolDuration(result, timing);
  const pending = !result && !error && running;
  const failed = Boolean(error || result?.isError);
  // 被插件拦截的标「未执行」，其余错误标「失败」；理由取实时报错或输出首行
  const blocked = Boolean(result?.blocked || timing?.blocked);
  const reason = error ?? (result?.isError ? result.output.split("\n")[0] : undefined) ?? "";
  const output = result
    ? result.output || t("agent_tool_no_output")
    : error ?? (pending ? t("agent_tool_running") : t("agent_tool_no_output"));
  return (
    <div className={`tool-item${failed ? " failed" : ""}`} data-testid="tool-item">
      <button
        type="button"
        className="tool-item-head"
        aria-expanded={open}
        title={args || undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon icon={open ? ICONS.chevronDown : ICONS.chevronRight} size="sm" className="tool-item-chevron" />
        <span className="tool-item-name mono">{call.name}</span>
        {args && <span className="tool-call-args mono">{args}</span>}
        {failed && (
          <span className="tool-call-error" data-testid="tool-call-error">
            {t(blocked ? "agent_tool_not_run" : "agent_tool_failed", { reason })}
          </span>
        )}
        {progress && (
          <span className="tool-call-progress" data-testid="subagent-progress">
            {progress.toolName
              ? t("subagent_progress_tool", { n: progress.turns, tool: progress.toolName })
              : t("subagent_progress_turn", { n: progress.turns })}
          </span>
        )}
        {duration && duration.waited >= 1000 && (
          <span className="tool-item-waited" data-testid="tool-waited">
            {t("agent_tool_waited", { time: formatDuration(duration.waited) })}
          </span>
        )}
        <span className="tool-item-meta" data-testid="tool-duration">
          {pending ? t("agent_tool_running") : duration ? formatDuration(duration.ms) : ""}
        </span>
      </button>
      {open && (
        <div className="tool-item-body">
          <div className="tool-io-label">{t("agent_tool_input")}</div>
          <pre className="tool-io mono">{JSON.stringify(call.arguments, null, 2)}</pre>
          <div className="tool-io-label">{t("agent_tool_output")}</div>
          <pre className={`tool-io mono${failed ? " error" : ""}`} data-testid="tool-output">{output}</pre>
        </div>
      )}
      {card && <div className="tool-item-card">{card}</div>}
    </div>
  );
}

/**
 * 对话流的渲染单元：单条消息（只渲染正文）、一段连续的工具调用组成的步骤组，
 * 或只含交互类调用（`ask_user`）的消息——只渲染它已处理的交互结论行。
 */
type StreamBlock =
  | { kind: "message"; index: number }
  | { kind: "interactions"; index: number }
  | { kind: "steps"; start: number; indices: number[]; calls: number; trailing: boolean };

/**
 * 连续的工具调用（及其结果）归为一个步骤组；模型的文字不进组、始终可见（Claude Code 式）。
 * 同一条消息里先有文字再有调用时，文字照常显示，调用另起一组。
 * 位于对话流末尾的组（`trailing`）默认展开，其后已有文字的组默认收起。
 */
function streamBlocks(messages: unknown[]): StreamBlock[] {
  const blocks: StreamBlock[] = [];
  let group: Extract<StreamBlock, { kind: "steps" }> | null = null;
  const flush = () => {
    if (group) blocks.push(group);
    group = null;
  };
  messages.forEach((message, index) => {
    if (messageToolResult(message)) {
      // 结果紧跟在调用之后，挂进当前组；不在组里的结果（调用已不在当前分支）单独渲染卡片
      if (group) group.indices.push(index);
      else blocks.push({ kind: "message", index });
      return;
    }
    const allCalls = messageRole(message) === "assistant" ? messageToolCalls(message) : [];
    const calls = allCalls.filter(isStepCall).length;
    if (!allCalls.length || messageText(message) || messageImages(message).length) {
      flush();
      blocks.push({ kind: "message", index });
    }
    if (!allCalls.length) return;
    if (!calls) {
      flush();
      blocks.push({ kind: "interactions", index });
      return;
    }
    group ??= { kind: "steps", start: index, indices: [], calls: 0, trailing: false };
    group.indices.push(index);
    group.calls += calls;
  });
  flush();
  const last = blocks[blocks.length - 1];
  if (last?.kind === "steps") last.trailing = true;
  return blocks;
}

// 上下文用量环形图（Claude Code 式）：环弧 = 已用 / 窗口；悬停/聚焦弹出精确数字。
// 窗口未知时只给灰环 + tokens 数（无单位裸数不上屏，G7）。用量语义色：≥90% crit、≥70% warn。
function ContextRing({
  tokens,
  windowSize,
  label,
}: {
  tokens: number | null;
  windowSize: number | null;
  label: string;
}) {
  const pct =
    tokens != null && windowSize ? Math.min(1, tokens / windowSize) : null;
  const R = 5;
  const C = 2 * Math.PI * R;
  const tone =
    pct == null
      ? "var(--mid)"
      : pct >= 0.9
        ? "var(--crit)"
        : pct >= 0.7
          ? "var(--warn)"
          : "var(--agent)";
  const pctText =
    pct == null ? "" : pct > 0 && pct * 100 < 0.1 ? "<0.1%" : `${(pct * 100).toFixed(1)}%`;
  const tip =
    tokens == null
      ? `${label} —`
      : windowSize
        ? `${label} ${tokens.toLocaleString()} / ${windowSize.toLocaleString()} · ${pctText}`
        : `${label} ${tokens.toLocaleString()} tokens`;
  return (
    <span className="context-ring" tabIndex={0} aria-label={tip}>
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <circle cx="7" cy="7" r={R} fill="none" stroke="var(--line2)" strokeWidth="2.4" />
        {pct != null && pct > 0 && (
          <circle
            cx="7"
            cy="7"
            r={R}
            fill="none"
            stroke={tone}
            strokeWidth="2.4"
            strokeDasharray={`${Math.max(C * pct, 0.9)} ${C}`}
            strokeLinecap="round"
            transform="rotate(-90 7 7)"
          />
        )}
      </svg>
      <span className="context-ring-tip" role="tooltip">
        {tip}
      </span>
    </span>
  );
}

export function AgentConversation() {
  const { t } = useI18n();
  const initialize = useAgentSessions((state) => state.initialize);
  const currentSessionId = useAgentSessions(
    (state) => state.currentSessionId,
  );
  const view = useAgentSessions((state) =>
    state.currentSessionId ? state.views[state.currentSessionId] : undefined,
  );
  const live = useAgentSessions((state) =>
    state.currentSessionId ? state.live[state.currentSessionId] : undefined,
  );
  const connected = useAgentSessions((state) => state.connected);
  const loading = useAgentSessions((state) => state.loading);
  const drawerOpen = useAgentSessions((state) => state.drawerOpen);
  const error = useAgentSessions((state) => state.error);
  const setDrawerOpen = useAgentSessions((state) => state.setDrawerOpen);
  const clearError = useAgentSessions((state) => state.clearError);
  const newSession = useAgentSessions((state) => state.newSession);
  const setPermissionMode = useAgentSessions(
    (state) => state.setPermissionMode,
  );
  const replyInteraction = useAgentSessions((state) => state.replyInteraction);
  const resolvedInteractions = useAgentSessions((state) =>
    state.currentSessionId ? state.resolvedInteractions[state.currentSessionId] : undefined,
  );
  const subagentProgress = useAgentSessions((state) =>
    state.currentSessionId ? state.subagentProgress[state.currentSessionId] : undefined,
  );
  const toolErrors = useAgentSessions((state) =>
    state.currentSessionId ? state.toolErrors[state.currentSessionId] : undefined,
  );
  const toolTimings = useAgentSessions((state) =>
    state.currentSessionId ? state.toolTimings[state.currentSessionId] : undefined,
  );
  // 步骤组的展开状态，按「会话:组起始消息下标」记录；未点过的组用默认值
  const [stepsOpen, setStepsOpen] = useState<Record<string, boolean>>({});
  const runNotice = useAgentSessions((state) =>
    state.currentSessionId ? state.runNotices[state.currentSessionId] : undefined,
  );
  const connection = useSession((state) => state.connection);
  const projects = useProjects((state) => state.projects);
  const projectsLoaded = useProjects((state) => state.loaded);
  // 能力判定：焦点对象声明了音画区间资源（SDD 11），不比较模态名（SDD 10 D-14）。
  const videoFocused = useSession((state) => Boolean(activeObject(state)?.resources.clip));
  const videoConnectionReady = connection.provider === "openai_compatible"
    && connection.model === "qwen3.8-omni-flash"
    && connection.mediaAdapter === "qwen-omni";
  const setPreview = useSession((state) => state.setImagePreview);
  const { send, regenerate, abort } = useConversation();
  const [configOpen, setConfigOpen] = useState(false);
  // Focus（含 chat 发行版）：连接配置在右侧设置面板（SDD feats/01 v1.7 D23）；Workbench 仍用浮层。
  const focusShell = useSession((state) => state.uiMode === "focus");
  const setFocusLayout = useSession((state) => state.setFocusLayout);
  const openConfig = () =>
    focusShell ? setFocusLayout({ rightOpen: true, sideView: "settings" }) : setConfigOpen(true);
  const streamRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void initialize().catch(() => undefined);
  }, [initialize]);

  const messages = useMemo(() => {
    const saved = view?.messages ?? [];
    const result = [...saved];
    // 乐观回显：命令已发出、快照未回来时先把这一轮画上（带图时用 content 块数组，
    // 与 transcript 里的形状一致，缩略图渲染走同一条路径）。
    const pendingImages = live?.pendingImages ?? [];
    if (
      (live?.pendingUser || pendingImages.length) &&
      !saved.some(
        (message) =>
          messageRole(message) === "user" &&
          messageText(message) === (live?.pendingUser ?? ""),
      )
    ) {
      result.push(
        pendingImages.length
          ? {
              role: "user",
              content: [
                ...pendingImages.map((image) => ({
                  type: "image" as const,
                  data: image.data,
                  mimeType: image.mime_type,
                })),
                ...(live?.pendingUser
                  ? [{ type: "text" as const, text: live.pendingUser }]
                  : []),
              ],
            }
          : { role: "user", content: live?.pendingUser ?? "" },
      );
    }
    if (live?.streamingAssistant) result.push(live.streamingAssistant);
    return result;
  }, [live, view?.messages]);

  useEffect(() => {
    const stream = streamRef.current;
    if (stream) stream.scrollTop = stream.scrollHeight;
  }, [messages]);

  const running =
    view?.phase === "running" ||
    view?.phase === "stopping" ||
    view?.phase === "compacting";
  const archived = view?.status === "archived";
  // 项目已移除或目录失效：会话可看不可发（SDD 13 §7.4 规则 4、§11.1）；项目列表未加载前不拦
  const projectReadonly =
    projectsLoaded && !!view && !projectWritable(view.project_id ?? null, projects);
  const inputDisabled =
    !connected || !view || archived || projectReadonly || !connection.model.trim();
  const reversedAssistantIndex = [...messages]
    .reverse()
    .findIndex((message: unknown) => messageRole(message) === "assistant");
  const lastAssistantIndex =
    reversedAssistantIndex < 0
      ? -1
      : messages.length - reversedAssistantIndex - 1;
  const context = view?.context_usage;
  // 窗口大小：运行时回传优先，缺省回退连接配置里的 contextWindow（自定义模型必填）。
  const contextWindow = context?.context_window ?? connection.contextWindow ?? null;

  // 已处理的交互请求显示在主对话中关联的工具调用之后；找不到该调用时（旧版 runtime、
  // 调用已不在当前分支）放在消息末尾。
  const anchoredInteractions = new Map<number, ResolvedInteraction[]>();
  const trailingInteractions: ResolvedInteraction[] = [];
  for (const item of resolvedInteractions ?? []) {
    const id = item.request.tool_call_id;
    // 取最后一条含该调用的消息：部分端点跨回合复用调用标识，请求总是属于最近的那次调用
    let at = -1;
    for (let index = messages.length - 1; id && index >= 0 && at < 0; index -= 1) {
      const message = messages[index];
      if (messageRole(message) === "assistant" && messageToolCalls(message).some((call) => call.id === id)) at = index;
    }
    if (at < 0) trailingInteractions.push(item);
    else anchoredInteractions.set(at, [...(anchoredInteractions.get(at) ?? []), item]);
  }

  // 工具结果挂到对应的工具调用条目上：取调用之后第一条同标识的结果——
  // 部分 OpenAI 兼容端点跨回合复用调用标识，不能只按标识查。
  const toolResultList = messages.flatMap((message, index) => {
    const result = messageToolResult(message);
    return result ? [{ result, index }] : [];
  });
  const resultFor = (callId: string, callIndex: number) =>
    toolResultList.find((item) => item.index > callIndex && item.result.toolCallId === callId);
  // 已有结果时以结果为准；实时的出错理由只覆盖还没有结果的调用。
  const errorFor = (callId: string, result: MessageToolResult | undefined) =>
    result && !result.isError ? undefined : toolErrors?.[callId];

  const blocks = streamBlocks(messages);
  // 头像只标一段智能体输出的开头：前一块不是用户消息（正文、步骤组、卡片、交互结论）时不再重复。
  function continuesAgent(previous: StreamBlock | undefined) {
    return previous !== undefined && (previous.kind !== "message" || messageRole(messages[previous.index]) !== "user");
  }
  // 待决交互卡片接在智能体输出之后时同样不重复头像
  const pendingContinues = continuesAgent(blocks[blocks.length - 1]);

  const owl = (
    <div className="who" title={t("agent_name")} aria-label={t("agent_name")}>
      <OwlLogo size={18} />
    </div>
  );

  // 工具结果的产出卡片；`actionable` 的卡片等人确认，不收进折叠的步骤组。
  // `inSteps`：卡片挂在步骤组的条目下方，子智能体卡片收成一行，点开看最终回复与过程。
  const resultCard = (message: unknown, inSteps = false): { node: ReactNode; key: string; actionable?: true } | null => {
    if (CHAT_EDITION) return null;
    const toolDetails = messageToolResultDetails(message);
    // 图谱引用卡片：consult_atlas 的工具结果（SDD 03 §12 / D-21），随历史持久呈现
    const atlasRef = parseAtlasReferenced(toolDetails);
    if (atlasRef) return { node: <AtlasRefCard payload={atlasRef} />, key: `atlas-${atlasRef.trace_id}` };
    // 对象卡片：open_file 的工具结果（SDD 13 §7.3 规则 4），是否上舞台由人来点
    const opened = parseObjectOpened(toolDetails);
    if (opened) return { node: <ObjectCard payload={opened} />, key: `obj-${opened.id}` };
    // 文件卡片：read_file 的工具结果（SDD 14 §7.4 规则 7），是否在舞台预览由人来点
    const fileRead = parseFileRead(toolDetails);
    if (fileRead) return { node: <FileCard payload={fileRead} />, key: `file-${fileRead.path}` };
    // 子智能体卡片：agent 的工具结果（SDD 18 §5.1），随历史持久呈现
    const subagentRun = parseSubagentRun(toolDetails);
    if (subagentRun) return { node: <SubagentCard payload={subagentRun} collapsible={inSteps} />, key: "subagent" };
    // 建议标注卡片：propose_annotation 的工具结果（SDD 02 §6），确认/驳回由人来点
    const proposed = parseAnnotationProposed(toolDetails);
    if (proposed?.annotation_id) {
      return { node: <SuggestionCard payload={proposed} />, key: `sugg-${proposed.annotation_id}`, actionable: true };
    }
    return null;
  };

  // `withOwl`：接在智能体输出之后的组不再重复头像。
  const renderSteps = (block: Extract<StreamBlock, { kind: "steps" }>, withOwl: boolean) => {
    const links = block.indices.flatMap((index) =>
      messageRole(messages[index]) === "assistant"
        ? messageToolCalls(messages[index]).flatMap((call, position) => {
            if (!isStepCall(call)) return [];
            const linked = resultFor(call.id, index);
            return [{ key: `${index}:${position}`, callId: call.id, linked, error: errorFor(call.id, linked?.result) }];
          })
        : [],
    );
    const linkFor = (index: number, position: number) => links.find((link) => link.key === `${index}:${position}`);
    const linkedIndices = new Set(links.flatMap((link) => (link.linked ? [link.linked.index] : [])));
    const actionable: ReactNode[] = [];
    const items = block.indices.map((index) => {
      const message = messages[index];
      const result = messageToolResult(message);
      if (result) {
        // 已挂到调用条目上的结果不再单独渲染；找不到调用（已不在当前分支）时照常显示卡片
        const card = linkedIndices.has(index) ? null : resultCard(message);
        if (card?.actionable) actionable.push(<Fragment key={`${card.key}-${index}`}>{card.node}</Fragment>);
        return card && !card.actionable ? <Fragment key={`${card.key}-${index}`}>{card.node}</Fragment> : null;
      }
      if (messageRole(message) !== "assistant") return null;
      return (
        <Fragment key={`step-${index}`}>
          {messageToolCalls(message).map((call, position) => {
            if (!isStepCall(call)) return null;
            const { linked, error } = linkFor(index, position) ?? {};
            const card = linked ? resultCard(messages[linked.index], true) : null;
            if (card?.actionable) actionable.push(<Fragment key={`${card.key}-${call.id}`}>{card.node}</Fragment>);
            return (
              <ToolCallItem
                key={call.id || call.name}
                call={call}
                result={linked?.result}
                timing={toolTimings?.[call.id]}
                error={error}
                progress={subagentProgress?.[call.id]}
                card={card && !card.actionable ? card.node : null}
                running={Boolean(running)}
              />
            );
          })}
          {!CHAT_EDITION && anchoredInteractions.get(index)?.map((item) => (
            <ResolvedInteractionLine key={`resolved-${item.request.request_id}`} item={item} />
          ))}
        </Fragment>
      );
    });
    const key = `${currentSessionId}:${block.start}`;
    // 对话流末尾的组默认展开（运行中可看进度），其后已有文字的组默认收起
    const open = stepsOpen[key] ?? block.trailing;
    // 总耗时：全部调用都有耗时才给出（运行中用实时计时）
    const totalMs = links.reduce<number | null>((sum, link) => {
      const duration = toolDuration(link.linked?.result, toolTimings?.[link.callId]);
      return sum === null || duration === undefined ? null : sum + duration.ms;
    }, 0);
    const failed = links.filter((link) => link.error || link.linked?.result.isError).length;
    return (
      <Fragment key={`steps-${block.start}`}>
        <div className={`turn assistant tool${withOwl ? "" : " continued"}`}>
          {withOwl && owl}
          <div className="tool-steps" data-testid="tool-steps">
            <button
              type="button"
              className="tool-steps-head"
              aria-expanded={open}
              onClick={() => setStepsOpen((state) => ({ ...state, [key]: !open }))}
            >
              <Icon icon={open ? ICONS.chevronDown : ICONS.chevronRight} size="sm" />
              <span>{t("agent_steps", { n: block.calls })}</span>
              {failed > 0 && <span className="tool-call-error">{t("agent_steps_failed", { n: failed })}</span>}
              {totalMs !== null && <span className="tool-item-meta">{formatDuration(totalMs)}</span>}
            </button>
            {open && <div className="tool-steps-body">{items}</div>}
          </div>
        </div>
        {actionable.map((node, i) => (
          <div className="turn assistant tool" key={`actionable-${block.start}-${i}`}>
            {owl}
            {node}
          </div>
        ))}
      </Fragment>
    );
  };

  const renderMessage = (message: (typeof messages)[number], index: number, withOwl: boolean) => {
    const card = resultCard(message);
    if (card) {
      return (
        <div className={`turn assistant tool${withOwl ? "" : " continued"}`} key={`${card.key}-${index}`}>
          {withOwl && owl}
          {card.node}
        </div>
      );
    }
    const role = messageRole(message);
    if (!role) return null;
    const text = messageText(message);
    const images = messageImages(message);
    // SDD 17 §5.1：调用 Skill 的用户消息只显示名称与附加说明，不展开 Skill 全文
    const skillCall = role === "user" ? parseSkillMessage(text) : null;
    if (skillCall) {
      return (
        <div className="turn user" key={`skill-${index}-${skillCall.name}`}>
          <div className="bubble skill-call" data-testid="skill-call">
            <span className="skill-call-name"><Icon icon={ICONS.skill} size="sm" /> {t("agent_skill_call", { name: skillCall.name })}</span>
            {skillCall.extra && <span className="skill-call-extra">{skillCall.extra}</span>}
          </div>
        </div>
      );
    }
    // 带工具调用的 assistant 消息都在步骤组里渲染（streamBlocks），这里只剩正文消息。
    return (
      <div
        className={`turn ${role === "user" ? "user" : "assistant"}`}
        key={`${role}-${index}-${text.slice(0, 24)}`}
      >
        {role === "assistant" && withOwl && owl}
        <div className={role === "user" ? "bubble" : "abody plain"}>
          {images.length > 0 && (
            <div className="message-images">
              {images.map((image, imageIndex) => (
                <button
                  key={`${index}-img-${imageIndex}`}
                  type="button"
                  className="message-image-open"
                  title={t("agent_image_zoom", {
                    name: t("agent_message_image"),
                  })}
                  aria-label={t("agent_image_zoom", {
                    name: t("agent_message_image"),
                  })}
                  onClick={() =>
                    setPreview({
                      src: image.dataUrl,
                      alt: t("agent_message_image"),
                    })
                  }
                >
                  <img src={image.dataUrl} alt={t("agent_message_image")} />
                </button>
              ))}
            </div>
          )}
          {role === "assistant" && text ? (
            <Markdown text={text} />
          ) : running || images.length || role !== "assistant" ? (
            text || (running && !images.length ? "…" : "")
          ) : (
            // 模型尚未输出就被中止或出错的回复：不留空气泡，仍可「重新生成」
            <span className="agent-no-reply" data-testid="agent-no-reply">{t("agent_no_reply")}</span>
          )}
        </div>
        {role === "assistant" &&
          index === lastAssistantIndex &&
          !running &&
          view?.status === "active" && (
            <button
              className="agent-regenerate"
              type="button"
              onClick={() => void regenerate()}
            >
              <Icon icon={ICONS.regenerate} size="sm" /> {t("agent_regenerate")}
            </button>
          )}
      </div>
    );
  };

  return (
    <aside className="agent agent-conversation">
      <header className="agent-toolbar">
        <button
          className="agent-iconbtn"
          type="button"
          title={t("agent_history")}
          onClick={() => setDrawerOpen(true)}
        >
          <Icon icon={ICONS.menu} size="md" />
        </button>
        <div className="agent-title" title={view?.title}>
          <span className={`connection-dot ${connected ? "online" : ""}`} />
          <b>{view?.title || t("agent_new_title")}</b>
        </div>
        <button
          className="agent-iconbtn"
          type="button"
          title={t("agent_new_session")}
          disabled={loading}
          onClick={() => void newSession()}
        >
          ＋
        </button>
        <button
          className="agent-iconbtn"
          type="button"
          title={t("agent_more")}
          onClick={() => setConfigOpen((open) => !open)}
        >
          ⋯
        </button>
        {configOpen && (
          <ConnectionConfig onClose={() => setConfigOpen(false)} />
        )}
      </header>

      {(!connected || error) && (
        <div className="agent-error" role="alert">
          <span>
            {!connected ? t("agent_offline") : error?.message}
            {error?.traceId ? ` · ${error.traceId}` : ""}
          </span>
          {error && (
            <button type="button" onClick={clearError} aria-label={t("ui_close")}>
              <Icon icon={ICONS.close} size="sm" />
            </button>
          )}
        </div>
      )}

      {!CHAT_EDITION && view?.warnings?.map((warning) => (
        <div className="agent-error" role="status" key={`warn-${warning.code}-${warning.path ?? ""}`}>
          <span>{t("agent_settings_warning", { path: warning.path ?? "settings.json", message: warning.message })}</span>
        </div>
      ))}

      {!CHAT_EDITION && videoFocused && !videoConnectionReady && (
        <div className="agent-error" role="status">
          <span>{t(connection.provider === "openai_compatible" && connection.model === "qwen3.8-omni-flash"
            ? "agent_video_adapter_required" : "agent_video_unsupported")}</span>
          <button className="agent-video-config" type="button" onClick={openConfig}>
            {t("cfg_title")}
          </button>
        </div>
      )}

      <div className="stream conversation-stream" ref={streamRef}>
        {!messages.length && !loading && (
          <div className="agent-empty">
            <Icon icon={ICONS.skill} size="lg" />
            <b>{t("agent_empty")}</b>
            <p>{t(CHAT_EDITION ? "chat_empty_hint" : "agent_empty_hint")}</p>
          </div>
        )}
        {loading && !view && (
          <div className="agent-empty">{t("agent_loading")}</div>
        )}
        {blocks.map((block, i) =>
          // 已处理的交互请求锚在带工具调用的消息上，随步骤组渲染（renderSteps）
          block.kind === "steps" ? renderSteps(block, !continuesAgent(blocks[i - 1]))
          : block.kind === "interactions" ? (
            !CHAT_EDITION && (
              <Fragment key={`i-${block.index}`}>
                {anchoredInteractions.get(block.index)?.map((item) => (
                  <ResolvedInteractionLine key={`resolved-${item.request.request_id}`} item={item} />
                ))}
              </Fragment>
            )
          ) : (
            <Fragment key={`m-${block.index}`}>
              {renderMessage(messages[block.index], block.index, !continuesAgent(blocks[i - 1]))}
            </Fragment>
          ),
        )}
        {!CHAT_EDITION && trailingInteractions.map((item) => (
          <ResolvedInteractionLine key={`resolved-${item.request.request_id}`} item={item} />
        ))}
        {!CHAT_EDITION && currentSessionId && view?.pending_interactions?.map((request, i) => (
          <div className={`turn assistant tool${pendingContinues || i > 0 ? " continued" : ""}`} key={`interaction-${request.request_id}`}>
            {!pendingContinues && i === 0 && owl}
            <InteractionCard
              request={request}
              onReply={(reply) => replyInteraction(currentSessionId, request.request_id, reply)}
            />
          </div>
        ))}
        {!CHAT_EDITION && runNotice && (
          <div className="run-notice" role="status" data-testid="run-notice">
            {runNotice.outcome === "budget_exceeded"
              ? t("agent_budget_exceeded")
              : t("agent_budget_wound_down", { turns: runNotice.turns })}
          </div>
        )}
        {!CHAT_EDITION && view?.video_answers?.map((record) => (
          <div className="turn assistant tool" key={`video-answer-${record.command_id}`}>
            <div className="who" title={t("agent_name")} aria-label={t("agent_name")}><OwlLogo size={18} /></div>
            <VideoEvidenceCard record={record} observations={view.video_observations ?? []} />
          </div>
        ))}
      </div>

      {archived && (
        <div className="agent-readonly">{t("agent_archived_readonly")}</div>
      )}
      {!archived && projectReadonly && (
        <div className="agent-readonly">{t("project_readonly")}</div>
      )}
      {!connection.model && (
        <div className="agent-readonly">{t("agent_model_required")} <button type="button" onClick={openConfig}>{t("cfg_title")}</button></div>
      )}
      <ConversationComposer
        running={Boolean(running)}
        disabled={inputDisabled}
        onSend={send}
        onAbort={abort}
        controls={
          <>
            <ContextRing
              tokens={context?.tokens ?? null}
              windowSize={contextWindow}
              label={t("agent_context")}
            />
            {/* 只显示模型名：服务类型对用户没有决策价值，点击进连接设置 */}
            <button className="composer-model" type="button" title={t("cfg_title")} onClick={openConfig}>
              {connection.model || t("agent_model_none")}
            </button>
            {!CHAT_EDITION && (
              <label className="composer-permission" title={t(`agent_permission_${view?.permission_mode ?? "controlled"}_hint`)}>
                <Icon icon={ICONS.permission} size="sm" />
                <select
                  aria-label={t("agent_permission")}
                  value={view?.permission_mode ?? "controlled"}
                  disabled={!view}
                  onChange={(event) => {
                    const mode = event.target.value as PermissionMode;
                    // 最高权限需显式确认（SDD 15 §7.4 规则 3）；取消则模式不变。
                    if (mode === "autonomous" && !window.confirm(t("agent_permission_autonomous_confirm"))) {
                      event.target.value = view?.permission_mode ?? "controlled";
                      return;
                    }
                    if (currentSessionId) void setPermissionMode(currentSessionId, mode);
                  }}
                >
                  {PERMISSION_MODES.map((mode) => (
                    <option key={mode} value={mode} title={t(`agent_permission_${mode}_hint`)}>
                      {t(`agent_permission_${mode}`)}
                    </option>
                  ))}
                </select>
                <Icon icon={ICONS.chevronDown} size="sm" />
              </label>
            )}
          </>
        }
      />
      {drawerOpen && <SessionDrawer />}
    </aside>
  );
}
