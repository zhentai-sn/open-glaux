import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { agentRuntimeApi } from "../../agent/runtime/client";
import type { SessionListItem } from "../../agent/runtime/types";
import type { ProjectView } from "../../api/types";
import { I18nProvider } from "../../i18n";
import { useAgentSessions } from "../../store/agentSessions";
import { useProjects } from "../../store/projects";
import { SessionDrawer } from "./SessionDrawer";

const base: SessionListItem = {
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
  project_id: null,
};
const archived: SessionListItem = {
  ...base,
  session_id: "019c0000-0000-7000-8000-000000000012",
  title: "Archived conversation",
  status: "archived",
};
const inLiver: SessionListItem = {
  ...base,
  session_id: "019c0000-0000-7000-8000-000000000013",
  title: "Liver question",
  project_id: "prj-liver",
  updated_at: "2026-07-28T00:00:00.000Z",
};
const liver: ProjectView = {
  id: "prj-liver",
  name: "liver",
  path: "/mnt/c/cases/liver",
  display_path: "C:\\cases\\liver",
  created_at: "2026-07-27T00:00:00.000Z",
  status: "ok",
};

function renderDrawer() {
  return render(
    <I18nProvider>
      <SessionDrawer />
    </I18nProvider>,
  );
}

function groupOf(name: string): HTMLElement {
  return screen.getByText(name).closest(".session-group") as HTMLElement;
}

describe("SessionDrawer", () => {
  const deleteSession = vi.fn().mockResolvedValue(undefined);
  const newSession = vi.fn().mockResolvedValue(undefined);
  const removeProject = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    localStorage.setItem("glaux.lang", "en");
    deleteSession.mockClear();
    newSession.mockClear();
    removeProject.mockClear();
    useAgentSessions.setState({
      sessions: [inLiver, base, archived],
      currentSessionId: base.session_id,
      search: "",
      drawerOpen: true,
      unread: {},
      deleteSession,
      newSession,
    });
    useProjects.setState({
      projects: [liver],
      loaded: true,
      known: { [liver.id]: { name: liver.name, path: liver.path, display_path: liver.display_path } },
      collapsed: {},
      showArchived: false,
      remove: removeProject,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("按项目分组，未归属会话进「No project」组", () => {
    renderDrawer();
    expect(within(groupOf("liver")).getByText("Liver question")).toBeInTheDocument();
    expect(within(groupOf("No project")).getByText("Active conversation")).toBeInTheDocument();
    expect(groupOf("liver").querySelector("button[title]")?.getAttribute("title")).toBe("C:\\cases\\liver");
  });

  it("归档默认隐藏；打开开关或搜索时显示", () => {
    renderDrawer();
    expect(screen.queryByText("Archived conversation")).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search conversations"), {
      target: { value: "archived" },
    });
    expect(screen.queryByText("Active conversation")).not.toBeInTheDocument();
    expect(screen.getByText("Archived conversation")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search conversations"), { target: { value: "" } });
    fireEvent.click(screen.getByLabelText("Show archived"));
    expect(screen.getByText("Archived conversation")).toBeInTheDocument();
  });

  it("组头「＋」在该项目下新建会话", () => {
    renderDrawer();
    fireEvent.click(within(groupOf("liver")).getByLabelText("New conversation in this project"));
    expect(newSession).toHaveBeenCalledWith("prj-liver");
    fireEvent.click(within(groupOf("No project")).getByLabelText("New conversation in this project"));
    expect(newSession).toHaveBeenCalledWith(null);
  });

  it("折叠组时仍显示当前会话", () => {
    useAgentSessions.setState({ currentSessionId: inLiver.session_id });
    useProjects.setState({ collapsed: { "prj-liver": true, __unassigned__: true } });
    renderDrawer();
    expect(screen.getByText("Liver question")).toBeInTheDocument();
    expect(screen.queryByText("Active conversation")).not.toBeInTheDocument();
  });

  it("状态点区分运行中、未读与出错", () => {
    useAgentSessions.setState({
      sessions: [{ ...inLiver, phase: "running" }, { ...base, phase: "error" }, { ...archived, status: "active" }],
      unread: { [archived.session_id]: true },
    });
    renderDrawer();
    expect(screen.getByLabelText("Running")).toBeInTheDocument();
    expect(screen.getByLabelText("Error")).toBeInTheDocument();
    expect(screen.getByLabelText("New result")).toBeInTheDocument();
  });

  it("已移除项目的会话进只读组，组头可重新打开", () => {
    useProjects.setState({ projects: [] });
    renderDrawer();
    const group = groupOf("liver (removed)");
    expect(within(group).getByText("Liver question")).toBeInTheDocument();
    expect(within(group).getByTitle("Reopen")).toBeInTheDocument();
    expect(within(group).queryByLabelText("New conversation in this project")).toBeNull();
  });

  it("项目列表未加载时按见过的项目分组，不误判为已移除", () => {
    useProjects.setState({ projects: [], loaded: false, refresh: vi.fn().mockRejectedValue(new Error("403")) });
    renderDrawer();
    expect(within(groupOf("liver")).getByText("Liver question")).toBeInTheDocument();
    expect(screen.queryByText("liver (removed)")).toBeNull();
  });

  it("项目下有运行中会话时拒绝移除", async () => {
    vi.spyOn(agentRuntimeApi, "listSessions").mockResolvedValue([{ ...inLiver, phase: "running" }]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderDrawer();
    fireEvent.click(within(groupOf("liver")).getByTitle("Remove project"));
    await waitFor(() => expect(agentRuntimeApi.listSessions).toHaveBeenCalled());
    expect(confirm).not.toHaveBeenCalled();
    expect(removeProject).not.toHaveBeenCalled();
  });

  it("无运行中会话时确认后移除，提示不删磁盘文件", async () => {
    vi.spyOn(agentRuntimeApi, "listSessions").mockResolvedValue([inLiver]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderDrawer();
    fireEvent.click(within(groupOf("liver")).getByTitle("Remove project"));
    await waitFor(() => expect(removeProject).toHaveBeenCalledWith("prj-liver"));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Files on disk"));
  });

  it("includes the title and irreversibility in deletion confirmation", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderDrawer();

    fireEvent.click(
      screen.getAllByTitle("Delete").find((button) =>
        button.closest(".session-item")?.textContent?.includes(base.title),
      )!,
    );

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining(base.title));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("cannot be recovered"));
    // 未归属会话：确认文案注明会删除工作区文件（SDD 16 §7.6）
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("files in its workspace"));
    expect(deleteSession).toHaveBeenCalledWith(base.session_id);
  });
});
