import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n";
import type { SessionView } from "../../agent/runtime/types";
import { useAgentSessions } from "../../store/agentSessions";
import { useSession } from "../../store/session";
import { AgentConversation } from "./AgentConversation";

const session: SessionView = {
  session_id: "019c0000-0000-7000-8000-000000000001",
  title: "Explain this scan",
  status: "active",
  permission_mode: "controlled",
  provider: "anthropic",
  model: "claude-test",
  phase: "idle",
  messages: [
    { role: "user", content: "What is visible?" },
    {
      role: "assistant",
      content: [{ type: "text", text: "A concise observation." }],
    },
  ],
  context_usage: { tokens: 128, context_window: 32_768 },
  created_at: "2026-07-27T00:00:00.000Z",
  updated_at: "2026-07-27T00:01:00.000Z",
  project_id: null,
};
const sessionListItem = {
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

describe("AgentConversation", () => {
  beforeEach(() => {
    localStorage.setItem("glaux.lang", "en");
    useAgentSessions.setState({
      sessions: [sessionListItem],
      currentSessionId: session.session_id,
      views: { [session.session_id]: session },
      live: {},
      initialized: true,
      loading: false,
      connected: true,
      drawerOpen: false,
      search: "",
      error: null,
      resolvedInteractions: {},
      toolErrors: {},
      runNotices: {},
    });
    useSession.getState().setConnection({
      provider: "anthropic",
      model: "claude-test",
      apiKey: "",
    });
  });

  afterEach(() => {
    useAgentSessions.setState({
      sessions: [],
      currentSessionId: null,
      views: {},
      live: {},
      initialized: false,
      connected: false,
    });
  });

  it("renders persisted messages, context and the controlled permission mode", () => {
    render(
      <I18nProvider>
        <AgentConversation />
      </I18nProvider>,
    );

    expect(screen.getByText("Explain this scan")).toBeInTheDocument();
    expect(screen.getByText("What is visible?")).toBeInTheDocument();
    expect(screen.getByText("A concise observation.")).toBeInTheDocument();
    // 上下文用量为环形图，精确数字在 aria-label/tooltip 里（Claude Code 式）
    expect(
      screen.getByLabelText(/Context usage 128 \/ 32,768/),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveValue("controlled");
    expect(screen.getByRole("textbox", { name: "Instruct the agent…" })).toBeEnabled();
  });

  // SDD 03 §12 / D-21：consult_atlas 的工具结果留在会话历史里，卡片刷新后仍在
  it("renders the atlas reference card from a persisted tool result", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("nf", { status: 404 }));
    useAgentSessions.setState({
      views: {
        [session.session_id]: {
          ...session,
          messages: [
            { role: "user", content: "What does EDD look like?" },
            {
              role: "toolResult",
              toolCallId: "call-1",
              toolName: "consult_atlas",
              isError: false,
              content: [],
              details: {
                kind: "glaux.atlas_referenced",
                payload: {
                  trace_id: "trace-1",
                  candidate_ids: ["a", "b", "c", "d"],
                  selected_ids: ["a", "b"],
                  excluded_by_egress: 1,
                  snapshots: [
                    { exemplar_id: "a", caption: "EDD subepithelial", tags: ["TEM"] },
                    { exemplar_id: "b", caption: "EDD mesangial", tags: ["TEM"] },
                  ],
                },
              },
            },
            { role: "assistant", content: [{ type: "text", text: "Case a matches." }] },
          ],
        } as unknown as SessionView,
      },
    });

    render(
      <I18nProvider>
        <AgentConversation />
      </I18nProvider>,
    );

    expect(await screen.findByTestId("atlas-ref-card")).toBeInTheDocument();
    expect(screen.getAllByTestId("atlas-ref-item")).toHaveLength(2);
    // 卡片不挤掉同一轮的正文
    expect(screen.getByText("Case a matches.")).toBeInTheDocument();
    fetchSpy.mockRestore();
  });

  it("asks for confirmation before switching to autonomous and keeps the mode when cancelled", () => {
    const setPermissionMode = vi.fn(async () => undefined);
    useAgentSessions.setState({ setPermissionMode });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<I18nProvider><AgentConversation /></I18nProvider>);
    const select = screen.getByRole("combobox");

    fireEvent.change(select, { target: { value: "autonomous" } });
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/run commands on this computer/u));
    expect(setPermissionMode).not.toHaveBeenCalled();
    expect(select).toHaveValue("controlled");

    confirm.mockReturnValue(true);
    fireEvent.change(select, { target: { value: "autonomous" } });
    expect(setPermissionMode).toHaveBeenCalledWith(session.session_id, "autonomous");
    confirm.mockRestore();
  });

  it("shows pending interaction cards, settings warnings and the budget notice", () => {
    const replyInteraction = vi.fn(async () => undefined);
    useAgentSessions.setState({
      replyInteraction,
      views: {
        [session.session_id]: {
          ...session,
          warnings: [{ code: "settings_invalid", message: "not valid JSON", path: "/home/u/.glaux/settings.json" }],
          pending_interactions: [{
            request_id: "r1", session_id: session.session_id, command_id: "c1", kind: "question",
            created_at: "2026-10-02T00:00:00.000Z", expires_at: "2026-10-02T00:30:00.000Z",
            question: { question: "Which side?", options: ["left"], allow_free_text: false },
          }],
        },
      },
      runNotices: { [session.session_id]: { outcome: "completed", turns: 51 } },
    });
    render(<I18nProvider><AgentConversation /></I18nProvider>);

    expect(screen.getByText("Settings file ignored: /home/u/.glaux/settings.json (not valid JSON)")).toBeInTheDocument();
    expect(screen.getByTestId("run-notice")).toHaveTextContent("after 51 turns");
    fireEvent.click(screen.getByTestId("interaction-option-0"));
    expect(replyInteraction).toHaveBeenCalledWith(session.session_id, "r1", { kind: "question", option: 0 });
  });

  it("shows why a tool call was not run", () => {
    useAgentSessions.setState({
      views: {
        [session.session_id]: {
          ...session,
          messages: [{ role: "assistant", content: [{ type: "toolCall", id: "t1", name: "run_task", arguments: {} }] }],
        },
      },
      toolErrors: { [session.session_id]: { t1: "The user denied run_task." } },
    });
    render(<I18nProvider><AgentConversation /></I18nProvider>);
    expect(screen.getByTestId("tool-call-error")).toHaveTextContent("Not run: The user denied run_task.");
  });

  it("shows live progress under a running agent call (SDD 18 §7.5)", () => {
    useAgentSessions.setState({
      views: {
        [session.session_id]: {
          ...session,
          messages: [{ role: "assistant", content: [{ type: "toolCall", id: "a1", name: "agent", arguments: { description: "find files" } }] }],
        },
      },
      subagentProgress: { [session.session_id]: { a1: { turns: 3, toolName: "read" } } },
    });
    render(<I18nProvider><AgentConversation /></I18nProvider>);
    expect(screen.getByTestId("subagent-progress")).toHaveTextContent("Sub-agent · turn 3 · calling read");
  });

  it("makes an archived conversation read-only", () => {
    useAgentSessions.setState({
      views: {
        [session.session_id]: { ...session, status: "archived" },
      },
    });

    render(
      <I18nProvider>
        <AgentConversation />
      </I18nProvider>,
    );

    expect(
      screen.getByText("Archived conversations are read-only."),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Instruct the agent…" })).toBeDisabled();
  });
});
