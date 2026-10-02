import { CHAT_EDITION } from "../edition";
import { create, type StoreApi, type UseBoundStore } from "zustand";

import {
  agentRuntimeApi,
  AgentRuntimeError,
  type AgentRuntimeClient,
} from "../agent/runtime/client";
import {
  connectSessionEvents,
  messageRole,
  type EventConnector,
} from "../agent/runtime/events";
import { applyToolExecutionEvent, type TaskOutputSink } from "../agent/toolBridge";
import { useProjects } from "./projects";
import { useSession } from "./session";
import {
  carryComposerFrom,
  dropWorkspace,
  restoreWorkspace,
  saveWorkspace,
  writeBackgroundTaskOutput,
} from "./sessionWorkspaces";
import type {
  ConnectionInput,
  PermissionMode,
  PromptImage,
  RuntimeEvent,
  SessionListItem,
  SessionStatus,
  SessionView,
  TranscriptMessage,
  InteractionOutcome,
  InteractionReply,
  InteractionRequest,
  RunOutcome,
  ViewerContext,
} from "../agent/runtime/types";

interface LiveSession {
  pendingUser?: string;
  /** 与 pendingUser 同属"已发出、快照尚未回来"的乐观回显（SDD 00 D-021）。 */
  pendingImages?: PromptImage[];
  streamingAssistant?: TranscriptMessage;
}

/** 已结束的交互请求（SDD 15 §5.1）：卡片折叠成一行结论；只存内存。 */
export interface ResolvedInteraction {
  request: InteractionRequest;
  outcome: InteractionOutcome;
  /** 本端回复的决定；他端回复或过期、取消时缺省。 */
  reply?: InteractionReply;
}

/** 预算收尾或中止的提示（SDD 15 §5.1）；下一次发送时清除。 */
export interface RunNotice {
  outcome: RunOutcome;
  turns: number;
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
  /** 后台完成、尚未被选中查看的会话（SDD 13 §7.4 规则 5、6）；只存内存。 */
  unread: Record<string, true>;
  /** 按会话保存已结束的交互请求、出错工具调用的理由与预算提示；只存内存。 */
  resolvedInteractions: Record<string, ResolvedInteraction[]>;
  toolErrors: Record<string, Record<string, string>>;
  runNotices: Record<string, RunNotice>;
  error: { code: string; message: string; traceId?: string } | null;

  initialize: () => Promise<void>;
  /**
   * 在项目下新建或复用空会话（SDD 13 §7.4 规则 9、§7.6 规则 3）。``projectId`` 缺省取当前会话的项目，
   * ``null`` 为未归属。``carryComposer`` 把当前草稿、附件、视频带到目标会话（胶囊切换，§7.5 规则 4）。
   */
  newSession: (projectId?: string | null, options?: { carryComposer?: boolean }) => Promise<void>;
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
  regenerate: (connection: ConnectionInput, viewer?: ViewerContext) => Promise<void>;
  abort: () => Promise<void>;
  setDrawerOpen: (open: boolean) => void;
  setSearch: (search: string) => void;
  clearError: () => void;
  applySnapshot: (snapshot: SessionView) => void;
  applyRuntimeEvent: (event: RuntimeEvent) => void;
  replyInteraction: (sessionId: string, requestId: string, reply: InteractionReply) => Promise<void>;
}

const CURRENT_SESSION_KEY = "glaux.agent.current-session";

/** 会话工作区的换入换出（SDD 13 §6.5）；测试可注入替身。 */
export interface WorkspaceHooks {
  save: (sessionId: string) => void;
  restore: (sessionId: string) => Promise<void>;
  drop: (sessionId: string) => void;
  backgroundSink: (sessionId: string) => TaskOutputSink;
  /** 把 ``fromSessionId`` 快照里的草稿、附件、视频移到前台（胶囊切换项目时）。 */
  carryComposer: (fromSessionId: string) => void;
}

const defaultWorkspaceHooks: WorkspaceHooks = {
  save: saveWorkspace,
  restore: restoreWorkspace,
  drop: dropWorkspace,
  carryComposer: carryComposerFrom,
  backgroundSink: (sessionId) => ({
    write: (imageId, output) => writeBackgroundTaskOutput(sessionId, imageId, output),
  }),
};

export function createAgentSessionsStore(
  runtime: AgentRuntimeClient = agentRuntimeApi,
  connectEvents: EventConnector = connectSessionEvents,
  workspaces: WorkspaceHooks = defaultWorkspaceHooks,
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
        onRuntimeEvent: (event) => store.getState().applyRuntimeEvent(event),
        onVideoAnswer: ({ session_id }) => {
          void runtime.getSession(session_id)
            .then((snapshot) => store.getState().applySnapshot(snapshot))
            .catch(() => undefined);
        },
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
      const previous = get().currentSessionId;
      if (previous !== sessionId) {
        if (previous) workspaces.save(previous);
        set((state) => {
          const unread = { ...state.unread };
          delete unread[sessionId];
          return { currentSessionId: sessionId, drawerOpen: false, unread };
        });
        await workspaces.restore(sessionId);
      } else {
        set({ drawerOpen: false });
      }
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
      unread: {},
      resolvedInteractions: {},
      toolErrors: {},
      runNotices: {},
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

      newSession: async (projectId, options) => {
        await run(async () => {
          const from = get().currentSessionId;
          const target =
            projectId === undefined
              ? (get().sessions.find((item) => item.session_id === from)?.project_id ?? null)
              : projectId;
          // 后端在同一项目已有空会话时返回它而非新建（SDD 00 §7 规则 2）
          const created = await runtime.createSession(crypto.randomUUID(), { project_id: target });
          get().applySnapshot(created);
          await refreshList();
          await select(created.session_id);
          if (options?.carryComposer && from && from !== created.session_id) {
            workspaces.carryComposer(from);
          }
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
          const deletedProject =
            get().sessions.find((item) => item.session_id === sessionId)?.project_id ?? null;
          await runtime.deleteSession(sessionId);
          disconnectors.get(sessionId)?.();
          disconnectors.delete(sessionId);
          workspaces.drop(sessionId);
          set((state) => {
            const views = { ...state.views };
            const live = { ...state.live };
            const unread = { ...state.unread };
            delete views[sessionId];
            delete live[sessionId];
            delete unread[sessionId];
            // 删的是当前会话时先置空，避免随后 select 把已删会话的前台状态存回快照
            return {
              views,
              live,
              unread,
              ...(state.currentSessionId === sessionId ? { currentSessionId: null } : {}),
            };
          });
          await refreshList();
          // 删的不是当前会话时停在原处；否则优先同项目的下一个会话
          const current = get().currentSessionId;
          if (current) return;
          const active = get().sessions.filter((item) => item.status === "active");
          const next =
            active.find((item) => (item.project_id ?? null) === deletedProject) ?? active[0];
          if (next) await select(next.session_id);
          else {
            const created = await runtime.createSession(crypto.randomUUID(), {
              project_id: deletedProject,
            });
            get().applySnapshot(created);
            await refreshList();
            await select(created.session_id);
          }
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
          runNotices: omit(state.runNotices, sessionId),
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

      regenerate: async (connection, viewer) => {
        const sessionId = get().currentSessionId;
        if (!sessionId) return;
        get().applySnapshot(
          await runtime.command(sessionId, {
            command_id: crypto.randomUUID(),
            type: "regenerate",
            connection,
            ...(viewer ? { viewer } : {}),
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

      replyInteraction: async (sessionId, requestId, reply) => {
        const request = get().views[sessionId]?.pending_interactions?.find((item) => item.request_id === requestId);
        try {
          await runtime.replyInteraction(sessionId, requestId, reply);
        } catch (error) {
          const runtimeError = error instanceof AgentRuntimeError
            ? error
            : new AgentRuntimeError(0, "runtime_unavailable", "Agent Runtime is unavailable.");
          set({ error: { code: runtimeError.code, message: runtimeError.message, ...(runtimeError.traceId ? { traceId: runtimeError.traceId } : {}) } });
          return;
        }
        if (!request) return;
        // 先记下本端的回复，interaction.resolved 到达时补上结局；两者顺序不定。
        set((state) => {
          const list = state.resolvedInteractions[sessionId] ?? [];
          const exists = list.some((item) => item.request.request_id === requestId);
          return {
            resolvedInteractions: {
              ...state.resolvedInteractions,
              [sessionId]: exists
                ? list.map((item) => (item.request.request_id === requestId ? { ...item, reply } : item))
                : [...list, { request, outcome: "answered" as const, reply }],
            },
          };
        });
      },

      applySnapshot: (snapshot) =>
        set((state) => {
          const item = toListItem(snapshot);
          const previousPhase = state.sessions.find(
            (candidate) => candidate.session_id === snapshot.session_id,
          )?.phase;
          // 后台会话从运行中回到 idle 即记未读（SDD 13 §11.3）；出错走状态点的出错态，不记未读
          const finishedInBackground =
            snapshot.session_id !== state.currentSessionId &&
            snapshot.phase === "idle" &&
            previousPhase !== undefined &&
            previousPhase !== "idle" &&
            previousPhase !== "error";
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
            ...(finishedInBackground
              ? { unread: { ...state.unread, [snapshot.session_id]: true as const } }
              : {}),
          };
        }),

      applyRuntimeEvent: (event) => {
        const sessionId = event.data.session_id;
        if (event.event === "interaction.request") {
          const request = event.data;
          set((state) => {
            const view = state.views[sessionId];
            if (!view) return {};
            const pending = (view.pending_interactions ?? []).filter((item) => item.request_id !== request.request_id);
            return { views: { ...state.views, [sessionId]: { ...view, pending_interactions: [...pending, request] } } };
          });
          return;
        }
        if (event.event === "interaction.resolved") {
          set((state) => {
            const view = state.views[sessionId];
            const request = view?.pending_interactions?.find((item) => item.request_id === event.data.request_id);
            const known = (state.resolvedInteractions[sessionId] ?? []).find((item) => item.request.request_id === event.data.request_id);
            const resolved = known
              ? (state.resolvedInteractions[sessionId] ?? []).map((item) =>
                  item.request.request_id === event.data.request_id ? { ...item, outcome: event.data.outcome } : item)
              : request
                ? [...(state.resolvedInteractions[sessionId] ?? []), { request, outcome: event.data.outcome }]
                : state.resolvedInteractions[sessionId] ?? [];
            return {
              resolvedInteractions: { ...state.resolvedInteractions, [sessionId]: resolved },
              ...(view ? {
                views: {
                  ...state.views,
                  [sessionId]: { ...view, pending_interactions: (view.pending_interactions ?? []).filter((item) => item.request_id !== event.data.request_id) },
                },
              } : {}),
            };
          });
          return;
        }
        if (event.event === "tool.end" && event.data.is_error && event.data.error_text) {
          const { tool_call_id: toolCallId, error_text: reason } = event.data;
          set((state) => ({
            toolErrors: { ...state.toolErrors, [sessionId]: { ...state.toolErrors[sessionId], [toolCallId]: reason } },
          }));
          return;
        }
        if (event.event === "run.settled") {
          const { outcome, budget } = event.data;
          set((state) => ({
            runNotices: budget.exhausted || outcome === "budget_exceeded"
              ? { ...state.runNotices, [sessionId]: { outcome, turns: budget.turns } }
              : omit(state.runNotices, sessionId),
          }));
        }
        if (event.event === "tool.end") {
          applyFileChanged(event.data.details, get().views[get().currentSessionId ?? ""]?.project_id ?? null);
          // 领域工具（run_task）产出 → 写回查看器（metrics / primitives），见 agent/toolBridge。
          // 后台会话的结果只进它自己的工作区快照，不改前台画面（SDD 13 §7.7 规则 5）。
          if (CHAT_EDITION) return;
          if (sessionId === get().currentSessionId) applyToolExecutionEvent(event.data);
          else applyToolExecutionEvent(event.data, workspaces.backgroundSink(sessionId));
          return;
        }
        if (event.event === "message.delta") {
          const message = event.data.message;
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
        if (event.event === "message.end" || event.event === "run.settled" || event.event === "context.compacted") {
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

/**
 * SDD 16 §7.4 规则 3：智能体写入项目文件后刷新目录树；正在预览的文档被改时重新加载
 * （换一个新的 DocumentRef 对象即触发 DocumentView 重新请求）。
 */
function applyFileChanged(details: unknown, currentProjectId: string | null): void {
  if (!details || typeof details !== "object") return;
  const d = details as { kind?: unknown; path?: unknown; project_id?: unknown };
  if (d.kind !== "glaux.file_changed" || typeof d.project_id !== "string" || typeof d.path !== "string") return;
  useProjects.getState().bumpFileChange(d.project_id);
  if (d.project_id !== currentProjectId) return;
  const session = useSession.getState();
  if (session.document?.path === d.path) session.setDocument({ ...session.document });
}

function omit<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const rest = { ...record };
  delete rest[key];
  return rest;
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
    project_id: view.project_id ?? null,
  };
}

export const useAgentSessions = createAgentSessionsStore();
