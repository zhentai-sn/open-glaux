import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n";
import type { SessionListItem } from "../../agent/runtime/types";
import { useAgentSessions } from "../../store/agentSessions";
import { SessionDrawer } from "./SessionDrawer";

const active: SessionListItem = {
  session_id: "019c0000-0000-7000-8000-000000000011",
  title: "Active conversation",
  status: "active",
  permission_mode: "controlled",
  provider: "anthropic",
  model: "model",
  phase: "idle",
  context_usage: null,
  created_at: "2026-07-27T00:00:00.000Z",
  updated_at: "2026-07-27T00:01:00.000Z",
};
const archived: SessionListItem = {
  ...active,
  session_id: "019c0000-0000-7000-8000-000000000012",
  title: "Archived conversation",
  status: "archived",
};

describe("SessionDrawer", () => {
  const deleteSession = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    localStorage.setItem("glaux.lang", "en");
    deleteSession.mockClear();
    useAgentSessions.setState({
      sessions: [active, archived],
      currentSessionId: active.session_id,
      search: "",
      drawerOpen: true,
      deleteSession,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("filters active and archived conversations without changing sessions", () => {
    render(
      <I18nProvider>
        <SessionDrawer />
      </I18nProvider>,
    );

    expect(screen.getByText("Active conversation")).toBeInTheDocument();
    expect(screen.getByText("Archived conversation")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Search conversations"), {
      target: { value: "archived" },
    });
    expect(screen.queryByText("Active conversation")).not.toBeInTheDocument();
    expect(screen.getByText("Archived conversation")).toBeInTheDocument();
  });

  it("includes the title and irreversibility in deletion confirmation", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <I18nProvider>
        <SessionDrawer />
      </I18nProvider>,
    );

    fireEvent.click(
      screen.getAllByTitle("Delete").find((button) =>
        button.closest(".session-item")?.textContent?.includes(active.title),
      )!,
    );

    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining(active.title),
    );
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("cannot be recovered"),
    );
    expect(deleteSession).toHaveBeenCalledWith(active.session_id);
  });
});
