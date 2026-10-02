// SDD 17 §7.6、§15.3：「技能」「提示词」页的列表、启停、编辑保存与项目级随会话变化。
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { agentRuntimeApi } from "../../agent/runtime/client";
import type { ResourceList } from "../../agent/runtime/types";
import { I18nProvider } from "../../i18n";
import { useAgentSessions } from "../../store/agentSessions";
import { PromptsView } from "./PromptsView";
import { SkillsView } from "./SkillsView";

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
  diagnostics: [{ source: "user", code: "invalid_metadata", message: "description is required", path: "/u/broken/SKILL.md" }],
};

function bindSession(projectId: string | null) {
  useAgentSessions.setState({
    currentSessionId: "s1",
    sessions: [],
    views: { s1: { session_id: "s1", project_id: projectId } as never },
  });
}

beforeEach(() => {
  localStorage.setItem("glaux.lang", "en");
  vi.spyOn(agentRuntimeApi, "listResources").mockResolvedValue(LIST);
});
afterEach(() => vi.restoreAllMocks());

describe("SkillsView", () => {
  it("lists sub-agent definitions read-only with their tools and turn limit", async () => {
    bindSession(null);
    render(<I18nProvider><SkillsView /></I18nProvider>);
    const section = await screen.findByTestId("agents-section");
    expect(section).toHaveTextContent("Sub-agents");
    expect(section).toHaveTextContent("General helper");
    expect(section).toHaveTextContent("All tools · Up to 20 turns");
    expect(section).toHaveTextContent("read, list_files · Up to 5 turns");
    expect(section.querySelector("input, button")).toBeNull();
  });

  it("groups skills by source with badges, toggles and diagnostics", async () => {
    bindSession(null);
    const toggle = vi.spyOn(agentRuntimeApi, "setSkillEnabled").mockResolvedValue({ name: "base", enabled: true });
    render(<I18nProvider><SkillsView /></I18nProvider>);
    expect(await screen.findByText("My base")).toBeInTheDocument();
    expect(screen.getByText("Overridden")).toBeInTheDocument();
    expect(screen.getByText("Manual only")).toBeInTheDocument();
    expect(screen.getByText(/description is required/u)).toBeInTheDocument();
    expect(screen.queryByText("This project", { selector: ".res-group-head" })).toBeNull();
    // 分组顺序为 本项目 → 个人 → 内置：第一个开关是个人的 base（当前停用）
    fireEvent.click(screen.getAllByRole("checkbox", { name: "Enable base" })[0]!);
    await waitFor(() => expect(toggle).toHaveBeenCalledWith("base", true));
  });

  it("creates a personal skill from a scaffold and saves it", async () => {
    bindSession(null);
    const put = vi.spyOn(agentRuntimeApi, "putSkill").mockResolvedValue({ item: { ...LIST.skills[1]!, name: "imt" }, diagnostics: [] });
    render(<I18nProvider><SkillsView /></I18nProvider>);
    await screen.findByText("My base");
    fireEvent.change(screen.getByLabelText("name-with-hyphens"), { target: { value: "imt" } });
    fireEvent.click(screen.getByRole("button", { name: /New skill/u }));
    const editor = screen.getByLabelText("SKILL.md") as HTMLTextAreaElement;
    expect(editor.value).toContain("name: imt");
    fireEvent.change(editor, { target: { value: "---\nname: imt\ndescription: x\n---\nBody" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(put).toHaveBeenCalledWith("user", "imt", "---\nname: imt\ndescription: x\n---\nBody", null));
    expect(await screen.findByText(/Takes effect from the next message/u)).toBeInTheDocument();
  });

  it("opens built-in skills read-only and shows the project group for a bound session", async () => {
    bindSession("prj-a");
    vi.spyOn(agentRuntimeApi, "getSkill").mockResolvedValue({ name: "base", source: "builtin", path: "/b/base/SKILL.md", content: "x", editable: false });
    render(<I18nProvider><SkillsView /></I18nProvider>);
    expect(await screen.findByText("This project", { selector: ".res-group-head" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("Built-in base"));
    expect(await screen.findByRole("button", { name: "Copy to personal" })).toBeInTheDocument();
    expect(screen.getByLabelText("SKILL.md")).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(agentRuntimeApi.listResources).toHaveBeenCalledWith("prj-a");
  });
});

describe("PromptsView", () => {
  it("edits personal instructions and shows the project editor only for bound sessions", async () => {
    bindSession(null);
    vi.spyOn(agentRuntimeApi, "getInstructions").mockResolvedValue({ scope: "user", path: "/u/GLAUX.md", content: "Use mm." });
    const put = vi.spyOn(agentRuntimeApi, "putInstructions").mockResolvedValue({ scope: "user", path: "/u/GLAUX.md", exists: true, bytes: 8 });
    render(<I18nProvider><PromptsView /></I18nProvider>);
    const editor = await screen.findByDisplayValue("Use mm.");
    expect(screen.queryByText("Project instructions (GLAUX.md)")).toBeNull();
    fireEvent.change(editor, { target: { value: "Use cm." } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]!);
    await waitFor(() => expect(put).toHaveBeenCalledWith("user", "Use cm.", null));
    expect(await screen.findByText("/review")).toBeInTheDocument();
  });

  it("previews the system prompt of the current conversation", async () => {
    bindSession("prj-a");
    vi.spyOn(agentRuntimeApi, "getInstructions").mockResolvedValue({ scope: "user", path: "/u/GLAUX.md", content: "" });
    const preview = vi.spyOn(agentRuntimeApi, "previewSystemPrompt").mockResolvedValue({ prompt: "You are Glaux…", tools: ["read", "run_task"] });
    const { useSession } = await import("../../store/session");
    useSession.getState().setConnection({ provider: "anthropic", model: "m", apiKey: "" });
    render(<I18nProvider><PromptsView /></I18nProvider>);
    expect(await screen.findByText("Project instructions (GLAUX.md)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Preview for this conversation" }));
    expect(await screen.findByTestId("prompt-preview")).toHaveTextContent("You are Glaux…");
    expect(screen.getByText("Tools: read, run_task")).toBeInTheDocument();
    expect(preview.mock.calls[0]![0]).toBe("s1");
  });
});
