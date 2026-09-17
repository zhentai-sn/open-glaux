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
import { useSession } from "../../store/session";
import { Icon } from "../Icon";
import { ICONS } from "../iconMap";
import type { PermissionMode } from "../../agent/runtime/types";
import { AtlasRefCard, parseAtlasReferenced } from "./AtlasRefCard";
import { SuggestionCard, parseAnnotationProposed } from "./SuggestionCard";
import { ConnectionConfig } from "./ConnectionConfig";
import { ConversationComposer } from "./ConversationComposer";
import { Markdown } from "./Markdown";
import { SessionDrawer } from "./SessionDrawer";
import { OwlLogo } from "../OwlLogo";

const PERMISSION_MODES: PermissionMode[] = [
  "observe",
  "suggest",
  "controlled",
  "autonomous",
];

// 工具调用状态行（退役 orchestration P3）："⚙ 调用 run_task"，让智能体的工具动作可见；
// 悬停显示入参。工具结果本身不在此渲染——run_task 的产出经 toolBridge 写回查看器。
function ToolCallLine({ call }: { call: MessageToolCall }) {
  const { t } = useI18n();
  const args = Object.entries(call.arguments)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("  ");
  return (
    <div className="tool-call" title={args || undefined}>
      <Icon icon={ICONS.config} size="sm" className="tool-call-icon" />
      <span>{t("agent_tool_call", { tool: call.name })}</span>
      {args && <span className="tool-call-args mono">{args}</span>}
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
  const connection = useSession((state) => state.connection);
  const setPreview = useSession((state) => state.setImagePreview);
  const { send, regenerate, abort } = useConversation();
  const [configOpen, setConfigOpen] = useState(false);
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
                  type: "image",
                  data: image.data,
                  mimeType: image.mime_type,
                })),
                ...(live?.pendingUser
                  ? [{ type: "text", text: live.pendingUser }]
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
  const inputDisabled =
    !connected || !view || archived || !connection.model.trim();
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
        <button type="button" onClick={() => setConfigOpen(true)}>
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
            onChange={(event) => {
              if (currentSessionId) {
                void setPermissionMode(
                  currentSessionId,
                  event.target.value as PermissionMode,
                );
              }
            }}
          >
            {PERMISSION_MODES.map((mode) => (
              <option key={mode} value={mode}>
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
                    <ToolCallLine key={call.id || call.name} call={call} />
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
                      <ToolCallLine key={call.id || call.name} call={call} />
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
      </div>

      {archived && (
        <div className="agent-readonly">{t("agent_archived_readonly")}</div>
      )}
      {!connection.model && (
        <div className="agent-readonly">{t("agent_model_required")} <button type="button" onClick={() => setConfigOpen(true)}>{t("cfg_title")}</button></div>
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
