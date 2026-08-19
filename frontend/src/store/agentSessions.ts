import { create, type StoreApi, type UseBoundStore } from "zustand";

import {
  agentRuntimeApi,
  AgentRuntimeError,
  type AgentRuntimeClient,
} from "../agent/runtime/client";
import {
  connectSessionEvents,
  messageRole,
  piEventType,
  type EventConnector,
} from "../agent/runtime/events";
import { applyToolExecutionEvent } from "../agent/toolBridge";
import type {
  ConnectionInput,
  PermissionMode,
  PromptImage,
  SessionListItem,
  SessionStatus,
  SessionView,
  ViewerContext,
} from "../agent/runtime/types";

interface LiveSession {
  pendingUser?: string;
  /** 与 pendingUser 同属"已发出、快照尚未回来"的乐观回显（SDD 00 D-021）。 */
  pendingImages?: PromptImage[];
  streamingAssistant?: unknown;
}

interface AgentSessionsState {
  sessions: SessionListItem[];
  currentSessionId: string | null;
  views: Record<string, SessionView>;
  live: Record<string, LiveSession>;
  initialized: boolean;
  loading: boolean;
  connected: boolean;
  drawerOpen: boolean;
  search: string;
  error: { code: string; message: string; traceId?: string } | null;

  initialize: () => Promise<void>;
  newSession: () => Promise<void>;
  selectSession: (sessionId: string) => Promise<void>;
  renameSession: (sessionId: string, title: string) => Promise<void>;
  setSessionStatus: (sessionId: string, status: SessionStatus) => Promise<void>;
  setPermissionMode: (
    sessionId: string,
    permissionMode: PermissionMode,
  ) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  sendPrompt: (
    content: string,
    images: PromptImage[],
    connection: ConnectionInput,
    viewer?: ViewerContext,
  ) => Promise<void>;
  regenerate: (connection: ConnectionInput) => Promise<void>;
  abort: () => Promise<void>;
  setDrawerOpen: (open: boolean) => void;
  setSearch: (search: string) => void;
  clearError: () => void;
  applySnapshot: (snapshot: SessionView) => void;
  applyPiEvent: (sessionId: string, event: unknown) => void;
}

const CURRENT_SESSION_KEY = "glaux.agent.current-session";

export function createAgentSessionsStore(
  runtime: AgentRuntimeClient = agentRuntimeApi,
  connectEvents: EventConnector = connectSessionEvents,
): UseBoundStore<StoreApi<AgentSessionsState>> {
  const disconnectors = new Map<string, () => void>();

  const ensureEvents = (
    sessionId: string,
    store: UseBoundStore<StoreApi<AgentSessionsState>>,
  ) => {
    if (disconnectors.has(sessionId)) return;
    disconnectors.set(
      sessionId,
      connectEvents(sessionId, {
        onSnapshot: (snapshot) => store.getState().applySnapshot(snapshot),
        onPiEvent: ({ session_id, event }) =>
          store.getState().applyPiEvent(session_id, event),
        onAdapterError: (error) => {
          store.setState({
            error: {
              code: error.code,
              message: error.message,
              traceId: error.trace_id,
            },
          });
          void runtime
            .getSession(error.session_id)
            .then((snapshot) => store.getState().applySnapshot(snapshot))
            .catch(() => undefined);
        },
        onConnectionChange: (connected) => store.setState({ connected }),
      }),
    );
  };

  // Assigned immediately below; callbacks created during initialization run later.
  let store!: UseBoundStore<StoreApi<AgentSessionsState>>;
  // eslint-disable-next-line prefer-const
  store = create<AgentSessionsState>((set, get) => {
    const run = async (operation: () => Promise<void>) => {
      set({ loading: true, error: null });
      try {
        await operation();
      } catch (error) {
        const runtimeError =
          error instanceof AgentRuntimeError
            ? error
            : new AgentRuntimeError(
                0,
                "runtime_unavailable",
                "Agent Runtime is unavailable.",
              );
        set({
          connected: runtimeError.status !== 0,
          error: {
            code: runtimeError.code,
            message: runtimeError.message,
            ...(runtimeError.traceId ? { traceId: runtimeError.traceId } : {}),
          },
        });
        throw error;
      } finally {
        set({ loading: false });
      }
    };

    const refreshList = async () => {
      const [active, archived] = await Promise.all([
        runtime.listSessions("active"),
        runtime.listSessions("archived"),
      ]);
      set({ sessions: [...active, ...archived] });
    };

    const select = async (sessionId: string) => {
      const snapshot = await runtime.getSession(sessionId);
      get().applySnapshot(snapshot);
      set({ currentSessionId: sessionId, drawerOpen: false });
      try {
        localStorage.setItem(CURRENT_SESSION_KEY, sessionId);
      } catch {
        // Local preference is optional.
      }
      ensureEvents(sessionId, store);
    };

    return {
      sessions: [],
      currentSessionId: null,
      views: {},
      live: {},
      initialized: false,
      loading: false,
      connected: false,
      drawerOpen: false,
      search: "",
      error: null,

      initialize: async () => {
        if (get().initialized || get().loading) return;
        await run(async () => {
          await runtime.health();
          await refreshList();
          let preferred: string | null = null;
          try {
            preferred = localStorage.getItem(CURRENT_SESSION_KEY);
          } catch {
            // Ignore unavailable localStorage.
          }
          const candidate =
            get().sessions.find((item) => item.session_id === preferred) ??
            get().sessions.find((item) => item.status === "active");
          if (candidate) await select(candidate.session_id);
          else {
            const created = await runtime.createSession(crypto.randomUUID());
            get().applySnapshot(created);
            await refreshList();
            await select(created.session_id);
          }
          set({ connected: true, initialized: true });
        });
      },

      newSession: async () => {
        await run(async () => {
          const created = await runtime.createSession(crypto.randomUUID());
          get().applySnapshot(created);
          await refreshList();
          await select(created.session_id);
        });
      },

      selectSession: async (sessionId) => {
        await run(() => select(sessionId));
      },

      renameSession: async (sessionId, title) => {
        await run(async () => {
          get().applySnapshot(await runtime.patchSession(sessionId, { title }));
          await refreshList();
        });
      },

      setSessionStatus: async (sessionId, status) => {
        await run(async () => {
          get().applySnapshot(await runtime.patchSession(sessionId, { status }));
          await refreshList();
        });
      },

      setPermissionMode: async (sessionId, permissionMode) => {
        await run(async () => {
          get().applySnapshot(
            await runtime.patchSession(sessionId, {
              permission_mode: permissionMode,
            }),
          );
          await refreshList();
        });
      },

      deleteSession: async (sessionId) => {
        await run(async () => {
          await runtime.deleteSession(sessionId);
          disconnectors.get(sessionId)?.();
          disconnectors.delete(sessionId);
          set((state) => {
            const views = { ...state.views };
            const live = { ...state.live };
            delete views[sessionId];
            delete live[sessionId];
            return { views, live };
          });
          await refreshList();
          const next = get().sessions.find((item) => item.status === "active");
          if (next) await select(next.session_id);
          else await get().newSession();
        });
      },

      sendPrompt: async (content, images, connection, viewer) => {
        const sessionId = get().currentSessionId;
        if (!sessionId) return;
        set((state) => ({
          live: {
            ...state.live,
            [sessionId]: {
              pendingUser: content,
              ...(images.length ? { pendingImages: images } : {}),
            },
          },
          error: null,
        }));
        try {
          const snapshot = await runtime.command(sessionId, {
            command_id: crypto.randomUUID(),
            type: "prompt",
            content,
            ...(images.length ? { images } : {}),
            connection,
            ...(viewer ? { viewer } : {}),
          });
          get().applySnapshot(snapshot);
          ensureEvents(sessionId, store);
        } catch (error) {
          set((state) => {
            const live = { ...state.live };
            delete live[sessionId];
            return { live };
          });
          throw error;
        }
      },

      regenerate: async (connection) => {
        const sessionId = get().currentSessionId;
        if (!sessionId) return;
        get().applySnapshot(
          await runtime.command(sessionId, {
            command_id: crypto.randomUUID(),
            type: "regenerate",
            connection,
          }),
        );
      },

      abort: async () => {
        const sessionId = get().currentSessionId;
        if (!sessionId) return;
        get().applySnapshot(
          await runtime.command(sessionId, {
            command_id: crypto.randomUUID(),
            type: "abort",
          }),
        );
      },

      setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
      setSearch: (search) => set({ search }),
      clearError: () => set({ error: null }),

      applySnapshot: (snapshot) =>
        set((state) => {
          const item = toListItem(snapshot);
          const sessions = [
            item,
            ...state.sessions.filter(
              (candidate) => candidate.session_id !== snapshot.session_id,
            ),
          ].sort((left, right) => right.updated_at.localeCompare(left.updated_at));
          const live = { ...state.live };
          if (snapshot.phase === "idle") delete live[snapshot.session_id];
          return {
            sessions,
            views: { ...state.views, [snapshot.session_id]: snapshot },
            live,
          };
        }),

      applyPiEvent: (sessionId, event) => {
        const type = piEventType(event);
        if (!type) return;
        if (type === "tool_execution_end") {
          // 领域工具（run_task）产出 → 写回查看器（metrics / primitives），见 agent/toolBridge
          applyToolExecutionEvent(event);
          return;
        }
        if (type === "message_update") {
          const message = (event as { message?: unknown }).message;
          if (messageRole(message) === "assistant") {
            set((state) => ({
              live: {
                ...state.live,
                [sessionId]: {
                  ...state.live[sessionId],
                  streamingAssistant: message,
                },
              },
            }));
          }
          return;
        }
        if (type === "message_end" || type === "agent_end" || type === "session_compact") {
          void runtime
            .getSession(sessionId)
            .then((snapshot) => get().applySnapshot(snapshot))
            .catch(() => undefined);
        }
      },
    };
  });

  return store;
}

function toListItem(view: SessionView): SessionListItem {
  return {
    session_id: view.session_id,
    title: view.title,
    status: view.status,
    permission_mode: view.permission_mode,
    provider: view.provider,
    model: view.model,
    phase: view.phase,
    context_usage: view.context_usage,
    created_at: view.created_at,
    updated_at: view.updated_at,
  };
}

export const useAgentSessions = createAgentSessionsStore();
