import { CHAT_EDITION } from "../../edition";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  messageImages,
  messageRole,
  messageText,
  messageToolCalls,
  messageToolResultDetails,
  type MessageToolCall,
} from "../../agent/runtime/events";
import { useConversation } from "../../agent/useConversation";
import { useI18n } from "../../i18n";
import { useAgentSessions } from "../../store/agentSessions";
import { useProjects } from "../../store/projects";
import { activeObject, useSession } from "../../store/session";
import { Icon } from "../Icon";
import { ICONS } from "../iconMap";
import type { PermissionMode } from "../../agent/runtime/types";
import { AtlasRefCard, parseAtlasReferenced } from "./AtlasRefCard";
import { SuggestionCard, parseAnnotationProposed } from "./SuggestionCard";
import { ObjectCard, parseObjectOpened } from "./ObjectCard";
import { FileCard, parseFileRead } from "./FileCard";
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

// 工具调用状态行（退役 orchestration P3）："⚙ 调用 run_task"，让智能体的工具动作可见；
// 悬停显示入参。工具结果本身不在此渲染——run_task 的产出经 toolBridge 写回查看器。
// 被拦截或失败的调用在下方附一行理由（SDD 15 §5.1）。
function ToolCallLine({ call, error }: { call: MessageToolCall; error?: string | undefined }) {
  const { t } = useI18n();
  const args = Object.entries(call.arguments)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("  ");
  return (
    <div className="tool-call" title={args || undefined}>
      <Icon icon={ICONS.config} size="sm" className="tool-call-icon" />
      <span>{t("agent_tool_call", { tool: call.name })}</span>
      {args && <span className="tool-call-args mono">{args}</span>}
      {error && <span className="tool-call-error" data-testid="tool-call-error">{t("agent_tool_not_run", { reason: error })}</span>}
    </div>
  );
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
  const toolErrors = useAgentSessions((state) =>
    state.currentSessionId ? state.toolErrors[state.currentSessionId] : undefined,
  );
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

      <div className="agent-configbar">
        <button type="button" onClick={openConfig}>
          {connection.provider === "openai_compatible"
            ? "OpenAI-compatible"
            : "Anthropic"}
          <span> · {connection.model || "—"}</span>
        </button>
        {!CHAT_EDITION && <label>
          <span>{t("agent_permission")}</span>
          <select
            value={view?.permission_mode ?? "controlled"}
            disabled={!view}
            title={t(`agent_permission_${view?.permission_mode ?? "controlled"}_hint`)}
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
        </label>}
        <ContextRing
          tokens={context?.tokens ?? null}
          windowSize={contextWindow}
          label={t("agent_context")}
        />
      </div>

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
        {messages.map((message, index) => {
          const toolDetails = messageToolResultDetails(message);
          // 图谱引用卡片：consult_atlas 的工具结果（SDD 03 §12 / D-21），随历史持久呈现
          const atlasRef = parseAtlasReferenced(toolDetails);
          if (!CHAT_EDITION && atlasRef) {
            return (
              <div className="turn assistant tool" key={`atlas-${index}-${atlasRef.trace_id}`}>
                <div className="who" title={t("agent_name")} aria-label={t("agent_name")}>
                  <OwlLogo size={18} />
                </div>
                <AtlasRefCard payload={atlasRef} />
              </div>
            );
          }
          // 对象卡片：open_file 的工具结果（SDD 13 §7.3 规则 4），是否上舞台由人来点
          const opened = parseObjectOpened(toolDetails);
          if (!CHAT_EDITION && opened) {
            return (
              <div className="turn assistant tool" key={`obj-${index}-${opened.id}`}>
                <div className="who" title={t("agent_name")} aria-label={t("agent_name")}>
                  <OwlLogo size={18} />
                </div>
                <ObjectCard payload={opened} />
              </div>
            );
          }
          // 文件卡片：read_file 的工具结果（SDD 14 §7.4 规则 7），是否在舞台预览由人来点
          const fileRead = parseFileRead(toolDetails);
          if (!CHAT_EDITION && fileRead) {
            return (
              <div className="turn assistant tool" key={`file-${index}-${fileRead.path}`}>
                <div className="who" title={t("agent_name")} aria-label={t("agent_name")}>
                  <OwlLogo size={18} />
                </div>
                <FileCard payload={fileRead} />
              </div>
            );
          }
          // 建议标注卡片：propose_annotation 的工具结果（SDD 02 §6），确认/驳回由人来点
          const proposed = parseAnnotationProposed(toolDetails);
          if (!CHAT_EDITION && proposed?.annotation_id) {
            return (
              <div className="turn assistant tool" key={`sugg-${index}-${proposed.annotation_id}`}>
                <div className="who" title={t("agent_name")} aria-label={t("agent_name")}>
                  <OwlLogo size={18} />
                </div>
                <SuggestionCard payload={proposed} />
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
          const toolCalls = role === "assistant" ? messageToolCalls(message) : [];
          // 只含工具调用、无正文的 assistant 消息 → 一条小状态行（不渲染空气泡）
          if (role === "assistant" && !text && toolCalls.length) {
            return (
              <div className="turn assistant tool" key={`tool-${index}-${toolCalls[0].id}`}>
                <div className="who" title={t("agent_name")} aria-label={t("agent_name")}>
                  <OwlLogo size={18} />
                </div>
                <div className="tool-calls">
                  {toolCalls.map((call) => (
                    <ToolCallLine key={call.id || call.name} call={call} error={toolErrors?.[call.id]} />
                  ))}
                </div>
              </div>
            );
          }
          return (
            <div
              className={`turn ${role === "user" ? "user" : "assistant"}`}
              key={`${role}-${index}-${text.slice(0, 24)}`}
            >
              {role === "assistant" && (
                <div className="who" title={t("agent_name")} aria-label={t("agent_name")}>
                  <OwlLogo size={18} />
                </div>
              )}
              <div className={role === "user" ? "bubble" : "abody plain"}>
                {toolCalls.length > 0 && (
                  <div className="tool-calls">
                    {toolCalls.map((call) => (
                      <ToolCallLine key={call.id || call.name} call={call} error={toolErrors?.[call.id]} />
                    ))}
                  </div>
                )}
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
                ) : (
                  text || (running && !images.length ? "…" : "")
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
        })}
        {!CHAT_EDITION && resolvedInteractions?.map((item) => (
          <ResolvedInteractionLine key={`resolved-${item.request.request_id}`} item={item} />
        ))}
        {!CHAT_EDITION && currentSessionId && view?.pending_interactions?.map((request) => (
          <div className="turn assistant tool" key={`interaction-${request.request_id}`}>
            <div className="who" title={t("agent_name")} aria-label={t("agent_name")}><OwlLogo size={18} /></div>
            <InteractionCard
              request={request}
              onReply={(reply) => void replyInteraction(currentSessionId, request.request_id, reply)}
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
      />
      {drawerOpen && <SessionDrawer />}
    </aside>
  );
}
