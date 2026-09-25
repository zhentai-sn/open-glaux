import { describe, expect, it, vi } from "vitest";

import type { AgentRuntimeClient } from "../agent/runtime/client";
import type {
  EventConnector,
  EventHandlers,
} from "../agent/runtime/events";
import type { SessionListItem, SessionView } from "../agent/runtime/types";
import { objectMeta } from "../test/fixtures";
import { createAgentSessionsStore } from "./agentSessions";

function view(id: string, index = 0): SessionView {
  return {
    session_id: id,
    title: `Session ${index}`,
    status: "active",
    permission_mode: "controlled",
    provider: null,
    model: null,
    phase: "idle",
    messages: [],
    context_usage: { tokens: 0 },
    created_at: new Date(2026, 0, index + 1).toISOString(),
    updated_at: new Date(2026, 0, index + 1).toISOString(),
  };
}

function listItem(session: SessionView): SessionListItem {
  return {
    session_id: session.session_id,
    title: session.title,
    status: session.status,
    permission_mode: session.permission_mode,
    provider: session.provider,
    model: session.model,
    phase: session.phase,
    context_usage: session.context_usage,
    created_at: session.created_at,
    updated_at: session.updated_at,
  };
}

function fixture() {
  const views = Array.from({ length: 20 }, (_, index) =>
    view(crypto.randomUUID(), index),
  );
  const handlers = new Map<string, EventHandlers>();
  const client = {
    health: vi.fn().mockResolvedValue({
      status: "ok",
      adapter: "ok",
      pi: "ok",
      storage: "ok",
    }),
    listSessions: vi
      .fn()
      .mockImplementation(async (status?: string) =>
        status === "archived" ? [] : views.map(listItem),
      ),
    createSession: vi.fn().mockImplementation(async (id: string) => view(id)),
    getSession: vi
      .fn()
      .mockImplementation(async (id: string) => views.find((item) => item.session_id === id)!),
    patchSession: vi.fn(),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    command: vi.fn().mockImplementation(async (id: string) => ({
      ...views.find((item) => item.session_id === id)!,
      phase: "running",
    })),
  } as unknown as AgentRuntimeClient;
  const connector: EventConnector = (sessionId, nextHandlers) => {
    handlers.set(sessionId, nextHandlers);
    return () => handlers.delete(sessionId);
  };
  return {
    views,
    handlers,
    client,
    store: createAgentSessionsStore(client, connector),
  };
}

describe("agent session store", () => {
  it("loads and switches 20 sessions without issuing abort", async () => {
    localStorage.clear();
    const { views, client, store } = fixture();

    await store.getState().initialize();
    expect(store.getState().sessions).toHaveLength(20);
    await store.getState().selectSession(views[5]!.session_id);

    expect(store.getState().currentSessionId).toBe(views[5]!.session_id);
    expect(client.command).not.toHaveBeenCalled();
  });

  it("keeps live messages isolated and does not retain credentials in state", async () => {
    localStorage.clear();
    const { handlers, store } = fixture();
    await store.getState().initialize();
    const sessionId = store.getState().currentSessionId!;
    const credential = "store-secret-credential";

    await store.getState().sendPrompt("hello", [], {
      provider: "anthropic",
      model: "model",
      credential,
    });
    handlers.get(sessionId)?.onPiEvent({
      session_id: sessionId,
      event: {
        type: "message_update",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "partial" }],
        },
      },
    });

    expect(store.getState().live[sessionId]?.streamingAssistant).toBeDefined();
    expect(JSON.stringify(store.getState())).not.toContain(credential);
  });
});

describe("会话状态隔离（SDD 13 §7.7）", () => {
  const runTaskEnd = (imageId: string, value: number) => ({
    type: "tool_execution_end",
    toolCallId: "c1",
    toolName: "run_task",
    isError: false,
    result: {
      content: [],
      details: {
        kind: "glaux.task_output",
        task: "t",
        image_id: imageId,
        output: { metrics: { d: { value, unit: "mm" } }, primitives: [] },
      },
    },
  });

  async function isolated() {
    localStorage.clear();
    const { useSession } = await import("./session");
    const ws = await import("./sessionWorkspaces");
    ws.resetWorkspacesForTest();
    useSession.setState({
      modality: "natural_image",
      objects: {
        natural_image: [
          objectMeta({ id: "x", modality: "natural_image" }),
          objectMeta({ id: "y", modality: "natural_image" }),
        ],
      },
      focus: null,
      metrics: null,
      composerDraft: "",
    });
    const f = fixture();
    await f.store.getState().initialize();
    const a = f.store.getState().currentSessionId!;
    const b = f.views.find((v) => v.session_id !== a)!.session_id;
    return { ...f, useSession, ws, a, b };
  }

  const focusOn = (id: string) => ({ object_id: id, kind: "image" as const, index: {}, region: null });

  it("后台会话的 run_task 结果不改前台度量，切回后显示", async () => {
    const { store, handlers, useSession, ws, a, b } = await isolated();
    useSession.setState({ focus: focusOn("x") });
    await store.getState().selectSession(b);
    useSession.setState({ focus: focusOn("y") });

    handlers.get(a)!.onPiEvent({ session_id: a, event: runTaskEnd("x", 1) });
    expect(useSession.getState().metrics).toBeNull();
    expect(ws.workspaceOf(a)?.metrics).toEqual({ d: { value: 1, unit: "mm" } });

    await store.getState().selectSession(a);
    expect(useSession.getState().focus?.object_id).toBe("x");
    expect(useSession.getState().metrics).toEqual({ d: { value: 1, unit: "mm" } });
  });

  it("两会话焦点同为一个对象时，后台结果也不覆盖前台", async () => {
    const { store, handlers, useSession, a, b } = await isolated();
    useSession.setState({ focus: focusOn("x") });
    await store.getState().selectSession(b);
    useSession.setState({ focus: focusOn("x") });

    handlers.get(a)!.onPiEvent({ session_id: a, event: runTaskEnd("x", 2) });
    expect(useSession.getState().metrics).toBeNull();

    handlers.get(b)!.onPiEvent({ session_id: b, event: runTaskEnd("x", 3) });
    expect(useSession.getState().metrics).toEqual({ d: { value: 3, unit: "mm" } });
  });

  it("草稿与焦点随会话切换，互不串", async () => {
    const { store, useSession, a, b } = await isolated();
    useSession.setState({ focus: focusOn("y"), composerDraft: "A 的半句话" });
    await store.getState().selectSession(b);
    expect(useSession.getState().composerDraft).toBe("");
    expect(useSession.getState().focus).toBeNull();

    await store.getState().selectSession(a);
    expect(useSession.getState().composerDraft).toBe("A 的半句话");
    expect(useSession.getState().focus?.object_id).toBe("y");
  });

  it("后台会话完成后标记未读，选中后清除", async () => {
    const { views, store, handlers, a, b } = await isolated();
    await store.getState().selectSession(b);
    const viewA = views.find((v) => v.session_id === a)!;

    handlers.get(a)!.onSnapshot({ ...viewA, phase: "running" });
    expect(store.getState().unread[a]).toBeUndefined();
    handlers.get(a)!.onSnapshot({ ...viewA, phase: "idle" });
    expect(store.getState().unread[a]).toBe(true);

    await store.getState().selectSession(a);
    expect(store.getState().unread[a]).toBeUndefined();
  });

  it("当前会话自己完成不记未读，出错不记未读", async () => {
    const { views, store, handlers, a, b } = await isolated();
    const viewA = views.find((v) => v.session_id === a)!;
    handlers.get(a)!.onSnapshot({ ...viewA, phase: "running" });
    handlers.get(a)!.onSnapshot({ ...viewA, phase: "idle" });
    expect(store.getState().unread[a]).toBeUndefined();

    await store.getState().selectSession(b);
    handlers.get(a)!.onSnapshot({ ...viewA, phase: "error" });
    handlers.get(a)!.onSnapshot({ ...viewA, phase: "idle" });
    expect(store.getState().unread[a]).toBeUndefined();
  });
});
