// SDD 13 §7.5：项目胶囊——空会话可切项目并带走草稿，有消息后只读。
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionView } from "../../agent/runtime/types";
import { I18nProvider } from "../../i18n";
import { useAgentSessions } from "../../store/agentSessions";
import { useProjects } from "../../store/projects";
import { ProjectChip } from "./ProjectChip";

const view: SessionView = {
  session_id: "s1",
  title: "New",
  status: "active",
  permission_mode: "controlled",
  provider: null,
  model: null,
  phase: "idle",
  messages: [],
  context_usage: null,
  created_at: "2026-09-25T00:00:00.000Z",
  updated_at: "2026-09-25T00:00:00.000Z",
  project_id: "prj-a",
};

const project = (id: string, name: string) => ({
  id,
  name,
  path: `/x/${name}`,
  display_path: `/x/${name}`,
  created_at: "2026-09-25T00:00:00.000Z",
  status: "ok" as const,
});

function renderChip() {
  return render(
    <I18nProvider>
      <ProjectChip />
    </I18nProvider>,
  );
}

describe("ProjectChip", () => {
  const newSession = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    localStorage.setItem("glaux.lang", "en");
    newSession.mockClear();
    const { messages, ...item } = view;
    expect(messages).toEqual([]);
    useAgentSessions.setState({
      sessions: [item],
      currentSessionId: view.session_id,
      views: { [view.session_id]: view },
      live: {},
      loading: false,
      newSession,
    });
    useProjects.setState({
      projects: [project("prj-a", "alpha"), project("prj-b", "beta")],
      known: {
        "prj-a": { name: "alpha", path: "/x/alpha", display_path: "/x/alpha" },
        "prj-b": { name: "beta", path: "/x/beta", display_path: "/x/beta" },
      },
      loaded: true,
    });
  });

  it("显示当前会话的项目，空会话切项目时带走草稿", () => {
    renderChip();
    const chip = screen.getByText("alpha").closest("button")!;
    expect(chip).toHaveAttribute("title", "/x/alpha");
    fireEvent.click(chip);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "beta" }));
    expect(newSession).toHaveBeenCalledWith("prj-b", { carryComposer: true });
  });

  it("选中当前项目不新建", () => {
    renderChip();
    fireEvent.click(screen.getByText("alpha").closest("button")!);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "alpha" }));
    expect(newSession).not.toHaveBeenCalled();
  });

  it("可切到未归属", () => {
    renderChip();
    fireEvent.click(screen.getByText("alpha").closest("button")!);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "No project" }));
    expect(newSession).toHaveBeenCalledWith(null, { carryComposer: true });
  });

  it("会话已有消息时只读", () => {
    useAgentSessions.setState({
      views: { [view.session_id]: { ...view, messages: [{ role: "user", content: "hi" }] } },
    });
    renderChip();
    const chip = screen.getByText("alpha").closest("button")!;
    expect(chip).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(chip);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("未归属会话显示「No project」", () => {
    useAgentSessions.setState({
      sessions: [{ ...useAgentSessions.getState().sessions[0]!, project_id: null }],
    });
    renderChip();
    expect(screen.getByText("No project")).toBeInTheDocument();
  });
});
