import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
    expect(screen.getByTitle("Context usage")).toHaveTextContent(
      "128 / 32,768",
    );
    expect(screen.getByRole("combobox")).toHaveValue("controlled");
    expect(screen.getByRole("textbox", { name: "Instruct the agent…" })).toBeEnabled();
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
