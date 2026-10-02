import { describe, expect, it, vi } from "vitest";

import { AgentRuntimeError, type AgentRuntimeClient } from "../agent/runtime/client";
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
    project_id: null,
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
    project_id: session.project_id,
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
    createSession: vi
      .fn()
      .mockImplementation(async (id: string, options?: { project_id?: string | null }) => {
        const created = { ...view(id), project_id: options?.project_id ?? null };
        views.push(created);
        return created;
      }),
    getSession: vi
      .fn()
      .mockImplementation(async (id: string) => views.find((item) => item.session_id === id)!),
    patchSession: vi.fn(),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    replyInteraction: vi.fn().mockResolvedValue({ outcome: "answered" }),
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

describe("interaction and run events (SDD 15 §9.5)", () => {
  const request = (sessionId: string) => ({
    request_id: "r1", session_id: sessionId, command_id: "c1", kind: "permission" as const,
    created_at: "2026-10-02T00:00:00.000Z", expires_at: "2026-10-02T00:30:00.000Z",
    permission: { tool_call_id: "t1", tool_name: "run_task", effect: "compute" as const, args_summary: "{}", grant_options: ["once" as const] },
  });

  it("tracks pending requests and folds them into resolved lines with the local reply", async () => {
    localStorage.clear();
    const { handlers, client, store } = fixture();
    await store.getState().initialize();
    const id = store.getState().currentSessionId!;

    handlers.get(id)!.onRuntimeEvent({ event: "interaction.request", data: request(id) });
    handlers.get(id)!.onRuntimeEvent({ event: "interaction.request", data: request(id) });
    expect(store.getState().views[id]?.pending_interactions).toHaveLength(1);

    await store.getState().replyInteraction(id, "r1", { kind: "permission", decision: "deny" });
    expect(client.replyInteraction).toHaveBeenCalledWith(id, "r1", { kind: "permission", decision: "deny" });
    handlers.get(id)!.onRuntimeEvent({ event: "interaction.resolved", data: { session_id: id, request_id: "r1", outcome: "answered" } });

    expect(store.getState().views[id]?.pending_interactions).toEqual([]);
    expect(store.getState().resolvedInteractions[id]).toEqual([
      expect.objectContaining({ outcome: "answered", reply: { kind: "permission", decision: "deny" } }),
    ]);
  });

  it("surfaces a stale reply as an error and keeps the request", async () => {
    localStorage.clear();
    const { handlers, client, store } = fixture();
    await store.getState().initialize();
    const id = store.getState().currentSessionId!;
    handlers.get(id)!.onRuntimeEvent({ event: "interaction.request", data: request(id) });
    vi.mocked(client.replyInteraction).mockRejectedValueOnce(new AgentRuntimeError(409, "interaction_resolved", "Interaction request is already resolved."));

    await store.getState().replyInteraction(id, "r1", { kind: "permission", decision: "once" });
    expect(store.getState().error).toMatchObject({ code: "interaction_resolved" });
    expect(store.getState().resolvedInteractions[id]).toBeUndefined();
  });

  it("refreshes the project tree and reloads the previewed document after an agent write (SDD 16 §7.4)", async () => {
    localStorage.clear();
    const { handlers, store, views } = fixture();
    await store.getState().initialize();
    const id = store.getState().currentSessionId!;
    const view = views.find((v) => v.session_id === id)!;
    store.setState((state) => ({ views: { ...state.views, [id]: { ...view, project_id: "prj-a" } } }));
    const { useProjects } = await import("./projects");
    const { useSession } = await import("./session");
    const previewed = { path: "reports/a.md" };
    useSession.getState().setDocument(previewed);
    const before = useProjects.getState().fileChanges["prj-a"] ?? 0;

    const end = (path: string, project_id = "prj-a") => handlers.get(id)!.onRuntimeEvent({
      event: "tool.end",
      data: { session_id: id, command_id: "c", tool_call_id: "t", tool_name: "edit", is_error: false, details: { kind: "glaux.file_changed", op: "edit", path, project_id } },
    });
    end("notes/other.md");
    expect(useProjects.getState().fileChanges["prj-a"]).toBe(before + 1);
    expect(useSession.getState().document).toBe(previewed);

    end("reports/a.md");
    expect(useSession.getState().document).toEqual(previewed);
    expect(useSession.getState().document).not.toBe(previewed);

    end("reports/a.md", "prj-b");
    expect(useProjects.getState().fileChanges["prj-b"]).toBe(1);
    useSession.getState().setDocument(null);
  });

  it("sends explicit skill and template invocations with the remaining text (SDD 17 §9.3)", async () => {
    localStorage.clear();
    const { client, store } = fixture();
    await store.getState().initialize();
    const id = store.getState().currentSessionId!;
    const connection = { provider: "anthropic" as const, model: "m" };
    await store.getState().sendPrompt("/imt-protocol left side", [], connection, undefined, { skill: "imt-protocol" });
    expect(vi.mocked(client.command).mock.lastCall![1]).toMatchObject({ content: "left side", skill: "imt-protocol" });
    expect(store.getState().live[id]?.pendingUser).toBe("/imt-protocol left side");
    await store.getState().sendPrompt("/compare A B", [], connection, undefined, { template: { name: "compare", args: "A B" } });
    expect(vi.mocked(client.command).mock.lastCall![1]).toMatchObject({ content: "", template: { name: "compare", args: "A B" } });
  });

  it("records tool errors and the budget notice, cleared by the next prompt", async () => {
    localStorage.clear();
    const { handlers, store } = fixture();
    await store.getState().initialize();
    const id = store.getState().currentSessionId!;

    handlers.get(id)!.onRuntimeEvent({
      event: "tool.end",
      data: { session_id: id, command_id: "c", tool_call_id: "t9", tool_name: "run_task", is_error: true, details: null, error_text: "denied" },
    });
    handlers.get(id)!.onRuntimeEvent({
      event: "run.settled",
      data: { session_id: id, command_id: "c", outcome: "budget_exceeded", budget: { turns: 54, elapsed_ms: 1, exhausted: true } },
    });
    expect(store.getState().toolErrors[id]).toEqual({ t9: "denied" });
    expect(store.getState().runNotices[id]).toEqual({ outcome: "budget_exceeded", turns: 54 });

    await store.getState().sendPrompt("again", [], { provider: "anthropic", model: "m" });
    expect(store.getState().runNotices[id]).toBeUndefined();
  });

  it("tracks sub-agent progress per agent call until the call ends (SDD 18 §7.5)", async () => {
    localStorage.clear();
    const { handlers, store } = fixture();
    await store.getState().initialize();
    const id = store.getState().currentSessionId!;
    const progress = (tool_call_id: string, turns: number, tool_name?: string) =>
      handlers.get(id)!.onRuntimeEvent({
        event: "subagent.progress",
        data: { session_id: id, command_id: "c", tool_call_id, turns, ...(tool_name ? { tool_name } : {}) },
      });

    progress("a1", 1);
    progress("a1", 2, "read");
    progress("a2", 1);
    expect(store.getState().subagentProgress[id]).toEqual({ a1: { turns: 2, toolName: "read" }, a2: { turns: 1 } });

    handlers.get(id)!.onRuntimeEvent({
      event: "tool.end",
      data: { session_id: id, command_id: "c", tool_call_id: "a1", tool_name: "agent", is_error: false, details: null },
    });
    expect(store.getState().subagentProgress[id]).toEqual({ a2: { turns: 1 } });

    handlers.get(id)!.onRuntimeEvent({
      event: "run.settled",
      data: { session_id: id, command_id: "c", outcome: "aborted", budget: { turns: 1, elapsed_ms: 1, exhausted: false } },
    });
    expect(store.getState().subagentProgress[id]).toBeUndefined();
  });
});

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
    handlers.get(sessionId)?.onRuntimeEvent({
      event: "message.delta",
      data: {
        session_id: sessionId,
        command_id: "c",
        message: { role: "assistant", content: [{ type: "text", text: "partial" }] },
      },
    });

    expect(store.getState().live[sessionId]?.streamingAssistant).toBeDefined();
    expect(JSON.stringify(store.getState())).not.toContain(credential);
  });
});

describe("会话状态隔离（SDD 13 §7.7）", () => {
  const runTaskEnd = (sessionId: string, imageId: string, value: number) => ({
    event: "tool.end" as const,
    data: {
      session_id: sessionId,
      command_id: "c",
      tool_call_id: "c1",
      tool_name: "run_task",
      is_error: false,
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

    handlers.get(a)!.onRuntimeEvent(runTaskEnd(a, "x", 1));
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

    handlers.get(a)!.onRuntimeEvent(runTaskEnd(a, "x", 2));
    expect(useSession.getState().metrics).toBeNull();

    handlers.get(b)!.onRuntimeEvent(runTaskEnd(b, "x", 3));
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

  it("后台会话收到 run.settled 时重新拉取快照并标记未读（SDD 15 §9.5）", async () => {
    const { views, store, handlers, client, a, b } = await isolated();
    await store.getState().selectSession(b);
    const viewA = views.find((v) => v.session_id === a)!;
    handlers.get(a)!.onSnapshot({ ...viewA, phase: "running" });
    vi.mocked(client.getSession).mockClear();

    handlers.get(a)!.onRuntimeEvent({
      event: "run.settled",
      data: { session_id: a, command_id: "c", outcome: "completed", budget: { turns: 1, elapsed_ms: 5, exhausted: false } },
    });

    await vi.waitFor(() => expect(store.getState().unread[a]).toBe(true));
    expect(client.getSession).toHaveBeenCalledWith(a);
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

  it("新建会话缺省落在当前会话的项目（SDD 13 §7.4 规则 9）", async () => {
    const { store, client, a } = await isolated();
    store.setState((state) => ({
      sessions: state.sessions.map((s) => (s.session_id === a ? { ...s, project_id: "prj-a" } : s)),
    }));
    await store.getState().newSession();
    expect(client.createSession).toHaveBeenLastCalledWith(expect.any(String), { project_id: "prj-a" });
    await store.getState().newSession(null);
    expect(client.createSession).toHaveBeenLastCalledWith(expect.any(String), { project_id: null });
  });

  it("胶囊切换项目时草稿随之带到目标会话，原会话清空（SDD 13 §7.5 规则 4）", async () => {
    const { store, useSession, ws, a } = await isolated();
    useSession.setState({ composerDraft: "带过去的话" });
    await store.getState().newSession("prj-b", { carryComposer: true });
    const target = store.getState().currentSessionId!;
    expect(target).not.toBe(a);
    expect(useSession.getState().composerDraft).toBe("带过去的话");
    expect(ws.workspaceOf(a)?.composerDraft).toBe("");
  });
});
