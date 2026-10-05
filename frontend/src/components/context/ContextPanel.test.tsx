// SDD 19 §7、§15.2：上下文页的分区导航、列表 → 详情、分段预览与工具挂载状态。
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { agentRuntimeApi, AgentRuntimeError } from "../../agent/runtime/client";
import type { ResourceList, SystemPromptPreview } from "../../agent/runtime/types";
import { I18nProvider, useI18n } from "../../i18n";
import { useAgentSessions } from "../../store/agentSessions";
import { useContextSection, type ContextSection } from "../../store/contextSection";
import { useSession } from "../../store/session";
import { ContextPanel } from "./ContextPanel";
import { setEditorDirty } from "./shared";

const LIST: ResourceList = {
  skills: [
    { name: "base", description: "Built-in base", source: "builtin", path: "/b/base/SKILL.md", enabled: true, model_invocable: true, overridden_by: "user" },
    { name: "base", description: "My base", source: "user", path: "/u/base/SKILL.md", enabled: false, model_invocable: false },
  ],
  templates: [{ name: "review", source: "user", path: "/u/prompts/review.md", description: "Review a result" }],
  instructions: [],
  agents: [
    { name: "general", description: "General helper", source: "builtin", path: "/b/agents/general.md", max_turns: 20 },
    { name: "scout", description: "Finds files", source: "user", path: "/u/agents/scout.md", tools: ["read", "list_files"], max_turns: 5 },
  ],
  tools: [
    { name: "run_task", plugin: "imaging", effect: "compute", requires: [] },
    { name: "list_files", plugin: "project", effect: "read", requires: ["project"] },
    { name: "read", plugin: "files", effect: "read", requires: [] },
    { name: "bash", plugin: "files", effect: "exec", requires: [] },
  ],
  diagnostics: [{ source: "user", code: "invalid_metadata", message: "description is required", path: "/u/broken/SKILL.md" }],
};

const PREVIEW: SystemPromptPreview = {
  prompt: "You are Glaux… Use mm. No image is currently open in the viewer.",
  segments: [
    { kind: "base", text: "You are Glaux…", est_tokens: 4 },
    { kind: "instructions", scope: "user", text: "Use mm.", est_tokens: 2 },
    { kind: "viewer", text: "No image is currently open in the viewer.", est_tokens: 11 },
  ],
  tools: [
    { name: "run_task", plugin: "imaging", effect: "compute", description: "Run a registered task.", parameters: { type: "object" }, est_tokens: 9 },
    { name: "read", plugin: "files", effect: "read", description: "Read a file.", parameters: { type: "object", properties: { path: {} } }, est_tokens: 7 },
  ],
  unmounted: [
    { name: "list_files", plugin: "project", reason: "needs_project" },
    { name: "bash", plugin: "files", reason: "mode" },
  ],
  est_tokens: { prompt: 17, tools: 16 },
};

function bindSession(projectId: string | null, sessionId: string | null = "s1") {
  useAgentSessions.setState({
    currentSessionId: sessionId,
    sessions: [],
    views: sessionId ? { [sessionId]: { session_id: sessionId, project_id: projectId } as never } : {},
  });
}

function renderAt(section: ContextSection) {
  useContextSection.setState({ section });
  return render(<I18nProvider><ContextPanel /></I18nProvider>);
}

const nav = () => screen.getByRole("navigation", { name: "Context" });

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("glaux.lang", "en");
  vi.spyOn(agentRuntimeApi, "listResources").mockResolvedValue(LIST);
  vi.spyOn(agentRuntimeApi, "getInstructions").mockResolvedValue({ scope: "user", path: "/u/GLAUX.md", content: "Use mm." });
  useSession.getState().setConnection({ provider: "anthropic", model: "m", apiKey: "" });
  bindSession(null);
});
afterEach(() => {
  vi.restoreAllMocks();
  setEditorDirty("skill", false);
  setEditorDirty("template", false);
  setEditorDirty("instructions:user", false);
});

describe("navigation", () => {
  it("groups sections as Instructions / Capabilities / Runtime / Extensions and disables memory and MCP", async () => {
    vi.spyOn(agentRuntimeApi, "previewSystemPrompt").mockResolvedValue(PREVIEW);
    renderAt("system");
    const items = within(nav()).getAllByRole("button").map((b) => b.textContent);
    expect(items.map((text) => text?.replace("Not available yet", "").trim())).toEqual([
      "System prompt", "Prompt templates", "Tools", "Sub-agents", "Skills", "Trajectory", "Memory", "MCP",
    ]);
    expect(within(nav()).getByText("Instructions")).toBeInTheDocument();
    expect(within(nav()).getByText("Capabilities")).toBeInTheDocument();
    expect(within(nav()).getByText("Runtime")).toBeInTheDocument();
    expect(within(nav()).getByText("Extensions")).toBeInTheDocument();
    const memory = within(nav()).getByRole("button", { name: /Memory/u });
    expect(memory).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(memory);
    expect(useContextSection.getState().section).toBe("system");
    fireEvent.click(within(nav()).getByRole("button", { name: "Tools" }));
    expect(useContextSection.getState().section).toBe("tools");
  });

  it("asks before leaving a section with unsaved edits", async () => {
    vi.spyOn(agentRuntimeApi, "getSkill").mockResolvedValue({ name: "base", source: "user", path: "/u/base/SKILL.md", content: "x", editable: true });
    renderAt("skills");
    fireEvent.click(await screen.findByText("My base"));
    fireEvent.change(await screen.findByLabelText("SKILL.md"), { target: { value: "changed" } });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(within(nav()).getByRole("button", { name: "Tools" }));
    expect(confirm).toHaveBeenCalled();
    expect(useContextSection.getState().section).toBe("skills");
    fireEvent.click(screen.getByRole("button", { name: /Back/u }));
    expect(screen.getByLabelText("SKILL.md")).toBeInTheDocument();
  });

  it("shows a retry when the resource list fails", async () => {
    vi.mocked(agentRuntimeApi.listResources).mockRejectedValueOnce(new AgentRuntimeError(500, "internal", "boom"));
    renderAt("agents");
    expect(await screen.findByText(/internal: boom/u)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("General helper")).toBeInTheDocument();
  });
});

describe("skills", () => {
  it("groups skills by source with badges, toggles and diagnostics", async () => {
    const toggle = vi.spyOn(agentRuntimeApi, "setSkillEnabled").mockResolvedValue({ name: "base", enabled: true });
    renderAt("skills");
    expect(await screen.findByText("My base")).toBeInTheDocument();
    expect(screen.getByText("Overridden")).toBeInTheDocument();
    expect(screen.getByText("Manual only")).toBeInTheDocument();
    expect(screen.getByText(/description is required/u)).toBeInTheDocument();
    expect(screen.queryByText("This project", { selector: ".res-group-head" })).toBeNull();
    fireEvent.click(screen.getAllByRole("checkbox", { name: "Enable base" })[0]!);
    await waitFor(() => expect(toggle).toHaveBeenCalledWith("base", true));
  });

  it("creates a personal skill in the detail view and returns to the list", async () => {
    const put = vi.spyOn(agentRuntimeApi, "putSkill").mockResolvedValue({ item: { ...LIST.skills[1]!, name: "imt" }, diagnostics: [] });
    renderAt("skills");
    await screen.findByText("My base");
    fireEvent.change(screen.getByLabelText("name-with-hyphens"), { target: { value: "imt" } });
    fireEvent.click(screen.getByRole("button", { name: /New skill/u }));
    const editor = screen.getByLabelText("SKILL.md") as HTMLTextAreaElement;
    expect(editor.value).toContain("name: imt");
    expect(screen.queryByText("My base")).toBeNull();
    fireEvent.change(editor, { target: { value: "---\nname: imt\ndescription: x\n---\nBody" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(put).toHaveBeenCalledWith("user", "imt", "---\nname: imt\ndescription: x\n---\nBody", null));
    expect(await screen.findByText(/Takes effect from the next message/u)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Back/u }));
    expect(await screen.findByText("My base")).toBeInTheDocument();
  });

  it("opens built-in skills read-only and shows the project group for a bound session", async () => {
    bindSession("prj-a");
    vi.spyOn(agentRuntimeApi, "getSkill").mockResolvedValue({ name: "base", source: "builtin", path: "/b/base/SKILL.md", content: "x", editable: false });
    renderAt("skills");
    expect(await screen.findByText("This project", { selector: ".res-group-head" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("Built-in base"));
    expect(await screen.findByRole("button", { name: "Copy to personal" })).toBeInTheDocument();
    expect(screen.getByLabelText("SKILL.md")).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(agentRuntimeApi.listResources).toHaveBeenCalledWith("prj-a");
  });
});

describe("templates and sub-agents", () => {
  it("opens a template in the detail view", async () => {
    vi.spyOn(agentRuntimeApi, "getTemplate").mockResolvedValue({ name: "review", source: "user", path: "/u/prompts/review.md", content: "Review $1" });
    renderAt("templates");
    fireEvent.click(await screen.findByText("/review"));
    expect(await screen.findByDisplayValue("Review $1")).toBeInTheDocument();
    expect(screen.queryByText("Review a result")).toBeNull();
  });

  it("lists sub-agent definitions read-only with their tools and turn limit", async () => {
    renderAt("agents");
    const section = await screen.findByTestId("agents-section");
    expect(section).toHaveTextContent("General helper");
    expect(section).toHaveTextContent("All tools · Up to 20 turns");
    expect(section).toHaveTextContent("read, list_files · Up to 5 turns");
    expect(section.querySelector("input, button")).toBeNull();
  });
});

describe("system prompt", () => {
  it("edits personal instructions, previews segments with token estimates and the full text", async () => {
    const preview = vi.spyOn(agentRuntimeApi, "previewSystemPrompt").mockResolvedValue(PREVIEW);
    const put = vi.spyOn(agentRuntimeApi, "putInstructions").mockResolvedValue({ scope: "user", path: "/u/GLAUX.md", exists: true, bytes: 8 });
    renderAt("system");
    expect(await screen.findByTestId("prompt-totals")).toHaveTextContent("System prompt ≈17 tokens · tool definitions ≈16 · total ≈33");
    expect(preview.mock.calls[0]![0]).toBe("s1");
    expect(screen.getByText("Built-in base")).toBeInTheDocument();
    expect(screen.getByText("Personal GLAUX.md")).toBeInTheDocument();
    expect(screen.getByText("Viewer context")).toBeInTheDocument();
    expect(screen.getAllByText("Read-only")).toHaveLength(2);
    expect(screen.queryByText("Project instructions (GLAUX.md)")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show full text" }));
    expect(screen.getByTestId("prompt-preview")).toHaveTextContent(PREVIEW.prompt);

    fireEvent.change(screen.getByDisplayValue("Use mm."), { target: { value: "Use cm." } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]!);
    await waitFor(() => expect(put).toHaveBeenCalledWith("user", "Use cm.", null));
    expect(await screen.findByText("Content changed — refresh to see it.")).toBeInTheDocument();
  });

  it("explains why there is no preview without a session or a model", async () => {
    const preview = vi.spyOn(agentRuntimeApi, "previewSystemPrompt");
    bindSession(null, null);
    const view = renderAt("system");
    expect(await screen.findByText("Open or start a conversation to preview.")).toBeInTheDocument();
    view.unmount();
    bindSession(null);
    useSession.getState().setConnection({ provider: "anthropic", model: "", apiKey: "" });
    renderAt("system");
    fireEvent.click(await screen.findByRole("button", { name: "Configure a model first" }));
    expect(useSession.getState().focusLayout).toMatchObject({ rightOpen: true, sideView: "settings" });
    expect(preview).not.toHaveBeenCalled();
  });

  it.each(["system", "tools"] as const)("does not crash on the legacy preview shape from an older runtime (%s)", async (section) => {
    vi.spyOn(agentRuntimeApi, "previewSystemPrompt").mockResolvedValue({ prompt: "You are Glaux…", tools: ["read"] } as never);
    renderAt(section);
    expect(await screen.findByText("The agent runtime is older than this page. Restart agent-runtime and refresh.")).toBeInTheDocument();
    expect(screen.queryByText("This part of Glaux ran into a problem")).toBeNull();
  });

  it("requests the preview in the interface language and again after switching (SDD 20 §15.2)", async () => {
    const preview = vi.spyOn(agentRuntimeApi, "previewSystemPrompt").mockResolvedValue(PREVIEW);
    function LangSwitch() {
      const { setLang } = useI18n();
      return <button type="button" onClick={() => setLang("zh")}>to-zh</button>;
    }
    useContextSection.setState({ section: "system" });
    render(<I18nProvider><LangSwitch /><ContextPanel /></I18nProvider>);
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
    expect(preview.mock.calls[0]![3]).toBe("en");
    fireEvent.click(screen.getByRole("button", { name: "to-zh" }));
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
    expect(preview.mock.calls[1]![3]).toBe("zh");
  });

  it("shows preview errors without hiding the editors", async () => {
    vi.spyOn(agentRuntimeApi, "previewSystemPrompt").mockRejectedValue(new AgentRuntimeError(404, "session_not_found", "Session not found."));
    renderAt("system");
    expect(await screen.findByText(/session_not_found/u)).toBeInTheDocument();
    expect(await screen.findByDisplayValue("Use mm.")).toBeInTheDocument();
  });
});

describe("tools", () => {
  it("shows the static catalog without a session", async () => {
    bindSession(null, null);
    renderAt("tools");
    expect(await screen.findByText("bash")).toBeInTheDocument();
    expect(screen.getByText("Run a shell command")).toBeInTheDocument();
    expect(screen.getByText("Exec")).toBeInTheDocument();
    expect(screen.queryByText("Mounted")).toBeNull();
    expect(screen.getByText("Open or start a conversation to preview.")).toBeInTheDocument();
  });

  it("marks mounted and unmounted tools and expands model-facing definitions", async () => {
    vi.spyOn(agentRuntimeApi, "previewSystemPrompt").mockResolvedValue(PREVIEW);
    const { container } = renderAt("tools");
    expect(await screen.findByText("2 of 4 mounted · tool definitions ≈16 tokens")).toBeInTheDocument();
    const row = (name: string) => container.querySelector(`[data-tool="${name}"]`) as HTMLElement;
    expect(row("run_task")).toHaveTextContent("Mounted");
    expect(row("list_files")).toHaveTextContent("Not mounted: needs a project conversation");
    expect(row("bash")).toHaveTextContent("Not mounted: not mounted in this permission mode");
    fireEvent.click(within(row("read")).getByText("read"));
    expect(row("read")).toHaveTextContent("Read a file.");
    expect(row("read")).toHaveTextContent('"properties"');
  });
});
