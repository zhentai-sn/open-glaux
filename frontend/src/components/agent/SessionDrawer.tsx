import { useI18n } from "../../i18n";
import { useAgentSessions } from "../../store/agentSessions";
import type { SessionListItem } from "../../agent/runtime/types";
import { Icon } from "../Icon";
import { ICONS } from "../iconMap";

function SessionGroup({
  title,
  sessions,
  currentSessionId,
}: {
  title: string;
  sessions: SessionListItem[];
  currentSessionId: string | null;
}) {
  const { t } = useI18n();
  const selectSession = useAgentSessions((state) => state.selectSession);
  const renameSession = useAgentSessions((state) => state.renameSession);
  const setSessionStatus = useAgentSessions((state) => state.setSessionStatus);
  const deleteSession = useAgentSessions((state) => state.deleteSession);

  if (!sessions.length) return null;
  return (
    <section className="session-group">
      <h3>{title}</h3>
      {sessions.map((session) => (
        <div
          className={`session-item ${
            session.session_id === currentSessionId ? "active" : ""
          }`}
          key={session.session_id}
        >
          <button
            className="session-select"
            type="button"
            onClick={() => void selectSession(session.session_id)}
          >
            <span>{session.title}</span>
            <small>{new Date(session.updated_at).toLocaleString()}</small>
          </button>
          <div className="session-actions">
            <button
              type="button"
              title={t("agent_rename")}
              onClick={() => {
                const title = window.prompt(t("agent_rename"), session.title);
                if (title?.trim()) {
                  void renameSession(session.session_id, title.trim());
                }
              }}
            >
              <Icon icon={ICONS.edit} size="sm" />
            </button>
            <button
              type="button"
              title={
                session.status === "active"
                  ? t("agent_archive")
                  : t("agent_restore")
              }
              onClick={() =>
                void setSessionStatus(
                  session.session_id,
                  session.status === "active" ? "archived" : "active",
                )
              }
            >
              <Icon icon={session.status === "active" ? ICONS.archive : ICONS.chevronUp} size="sm" />
            </button>
            <button
              type="button"
              title={t("agent_delete")}
              onClick={() => {
                if (
                  window.confirm(
                    t("agent_delete_confirm", { title: session.title }),
                  )
                ) {
                  void deleteSession(session.session_id);
                }
              }}
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}

export function SessionDrawer() {
  const { t } = useI18n();
  const sessions = useAgentSessions((state) => state.sessions);
  const currentSessionId = useAgentSessions(
    (state) => state.currentSessionId,
  );
  const search = useAgentSessions((state) => state.search);
  const setSearch = useAgentSessions((state) => state.setSearch);
  const setDrawerOpen = useAgentSessions((state) => state.setDrawerOpen);
  const query = search.trim().toLocaleLowerCase();
  const visible = sessions.filter((session) =>
    session.title.toLocaleLowerCase().includes(query),
  );
  const active = visible.filter((session) => session.status === "active");
  const archived = visible.filter((session) => session.status === "archived");

  return (
    <div className="session-drawer" aria-label={t("agent_history")}>
      <div className="session-drawer-head">
        <b>{t("agent_history")}</b>
        <button
          type="button"
          aria-label="Close"
          onClick={() => setDrawerOpen(false)}
        >
          <Icon icon={ICONS.close} size="sm" />
        </button>
      </div>
      <input
        className="session-search"
        type="search"
        placeholder={t("agent_search_sessions")}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="session-list">
        {!visible.length && (
          <div className="agent-empty">{t("agent_no_sessions")}</div>
        )}
        <SessionGroup
          title={t("agent_active_sessions")}
          sessions={active}
          currentSessionId={currentSessionId}
        />
        <SessionGroup
          title={t("agent_archived_sessions")}
          sessions={archived}
          currentSessionId={currentSessionId}
        />
      </div>
    </div>
  );
}
