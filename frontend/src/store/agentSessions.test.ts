import { describe, expect, it, vi } from "vitest";

import type { AgentRuntimeClient } from "../agent/runtime/client";
import type {
  EventConnector,
  EventHandlers,
} from "../agent/runtime/events";
import type { SessionListItem, SessionView } from "../agent/runtime/types";
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

    await store.getState().sendPrompt("hello", {
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
