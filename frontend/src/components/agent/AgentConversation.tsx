import { useEffect, useMemo, useRef, useState } from "react";

import { messageRole, messageText } from "../../agent/runtime/events";
import { useConversation } from "../../agent/useConversation";
import { useI18n } from "../../i18n";
import { useAgentSessions } from "../../store/agentSessions";
import { useSession } from "../../store/session";
import type { PermissionMode } from "../../agent/runtime/types";
import { ConnectionConfig } from "./ConnectionConfig";
import { ConversationComposer } from "./ConversationComposer";
import { SessionDrawer } from "./SessionDrawer";

const PERMISSION_MODES: PermissionMode[] = [
  "observe",
  "suggest",
  "controlled",
  "autonomous",
];

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
  const { send, regenerate, abort } = useConversation();
  const [configOpen, setConfigOpen] = useState(false);
  const streamRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void initialize().catch(() => undefined);
  }, [initialize]);

  const messages = useMemo(() => {
    const saved = view?.messages ?? [];
    const result = [...saved];
    if (
      live?.pendingUser &&
      !saved.some(
        (message) =>
          messageRole(message) === "user" &&
          messageText(message) === live.pendingUser,
      )
    ) {
      result.push({ role: "user", content: live.pendingUser });
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
  const contextLabel = context
    ? context.context_window
      ? `${context.tokens.toLocaleString()} / ${context.context_window.toLocaleString()}`
      : context.tokens.toLocaleString()
    : "—";

  return (
    <aside className="agent agent-conversation">
      <header className="agent-toolbar">
        <button
          className="agent-iconbtn"
          type="button"
          title={t("agent_history")}
          onClick={() => setDrawerOpen(true)}
        >
          ☰
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
        <label>
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
        </label>
        <span className="context-usage" title={t("agent_context")}>
          ◔ {contextLabel}
        </span>
      </div>

      {(!connected || error) && (
        <div className="agent-error" role="alert">
          <span>
            {!connected ? t("agent_offline") : error?.message}
            {error?.traceId ? ` · ${error.traceId}` : ""}
          </span>
          {error && (
            <button type="button" onClick={clearError}>
              ✕
            </button>
          )}
        </div>
      )}

      <div className="stream conversation-stream" ref={streamRef}>
        {!messages.length && !loading && (
          <div className="agent-empty">
            <span>✦</span>
            <b>{t("agent_empty")}</b>
            <p>{t("agent_empty_hint")}</p>
          </div>
        )}
        {loading && !view && (
          <div className="agent-empty">{t("agent_loading")}</div>
        )}
        {messages.map((message, index) => {
          const role = messageRole(message);
          if (!role) return null;
          const text = messageText(message);
          return (
            <div
              className={`turn ${role === "user" ? "user" : "assistant"}`}
              key={`${role}-${index}-${text.slice(0, 24)}`}
            >
              {role === "assistant" && (
                <div className="who">
                  <span className="d" />
                  {t("agent_name")}
                </div>
              )}
              <div className={role === "user" ? "bubble" : "abody plain"}>
                {text || (running ? "…" : "")}
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
                    ↻ {t("agent_regenerate")}
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
        <div className="agent-readonly">{t("agent_model_required")}</div>
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
