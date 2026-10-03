// SDD 17 §7.7、§5.1、§15.2：`/` 菜单解析、输入框菜单交互、Skill 调用消息紧凑显示。
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { agentRuntimeApi } from "../../agent/runtime/client";
import type { ResourceList } from "../../agent/runtime/types";
import { I18nProvider } from "../../i18n";
import { useSession } from "../../store/session";
import { ConversationComposer } from "./ConversationComposer";
import { parseInvocation, parseSkillMessage, slashItems, slashQuery } from "./slashCommands";

const LIST: ResourceList = {
  skills: [
    { name: "imt-protocol", description: "Carotid IMT", source: "user", path: "/u", enabled: true, model_invocable: true },
    { name: "imt-old", description: "old", source: "builtin", path: "/b", enabled: true, model_invocable: true, overridden_by: "user" },
    { name: "off", description: "disabled", source: "user", path: "/u2", enabled: false, model_invocable: true },
  ],
  templates: [{ name: "compare", source: "user", path: "/p", description: "Compare two" }],
  instructions: [],
  diagnostics: [],
};

describe("slash command parsing", () => {
  it("lists enabled, non-overridden skills and templates", () => {
    expect(slashItems(LIST).map((i) => `${i.kind}:${i.name}`)).toEqual(["template:compare", "skill:imt-protocol"]);
  });

  it("opens the menu only while typing the name", () => {
    expect(slashQuery("/im")).toBe("im");
    expect(slashQuery("/")).toBe("");
    expect(slashQuery("/imt left")).toBeNull();
    expect(slashQuery("hello /imt")).toBeNull();
  });

  it("turns known names into invocations and leaves the rest as plain text", () => {
    const items = slashItems(LIST);
    expect(parseInvocation("/imt-protocol left side", items)).toEqual({ invocation: { skill: "imt-protocol" }, rest: "left side" });
    expect(parseInvocation("/compare A \"B C\"", items)).toEqual({ invocation: { template: { name: "compare", args: "A \"B C\"" } }, rest: "A \"B C\"" });
    expect(parseInvocation("/off now", items)).toBeNull();
    expect(parseInvocation("/usr/bin is a path", items)).toBeNull();
  });

  it("parses skill invocation messages", () => {
    expect(parseSkillMessage('<skill name="imt-protocol" location="/u/SKILL.md">\nBody\n</skill>\n\nleft side'))
      .toEqual({ name: "imt-protocol", extra: "left side" });
    expect(parseSkillMessage("plain text")).toBeNull();
  });
});

describe("composer slash menu", () => {
  beforeEach(() => {
    localStorage.setItem("glaux.lang", "en");
    useSession.setState({ composerDraft: "", composerAttachments: [] });
    vi.spyOn(agentRuntimeApi, "listResources").mockResolvedValue(LIST);
  });
  afterEach(() => vi.restoreAllMocks());

  function setup() {
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<I18nProvider><ConversationComposer running={false} disabled={false} onSend={onSend} onAbort={vi.fn()} /></I18nProvider>);
    return { onSend, box: screen.getByRole("textbox") };
  }

  it("filters, completes with Enter and sends an invocation", async () => {
    const { onSend, box } = setup();
    fireEvent.change(box, { target: { value: "/im" } });
    expect(await screen.findByRole("option", { name: /\/imt-protocol/u })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /\/compare/u })).toBeNull();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(useSession.getState().composerDraft).toBe("/imt-protocol ");
    fireEvent.change(box, { target: { value: "/imt-protocol left side" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("/imt-protocol left side", [], { skill: "imt-protocol" }));
  });

  it("recognizes a whole command pasted at once, before the menu ever opened", async () => {
    const { onSend, box } = setup();
    fireEvent.change(box, { target: { value: "/compare A B" } });
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("/compare A B", [], { template: { name: "compare", args: "A B" } }));
  });

  it("closes on Escape and sends unknown names as plain text", async () => {
    const { onSend, box } = setup();
    fireEvent.change(box, { target: { value: "/" } });
    await screen.findByRole("listbox");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.change(box, { target: { value: "/nothing here" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("/nothing here", [], undefined));
  });
});

describe("skill call message", () => {
  it("renders compactly in the conversation", async () => {
    const { useAgentSessions } = await import("../../store/agentSessions");
    const { AgentConversation } = await import("./AgentConversation");
    localStorage.setItem("glaux.lang", "en");
    useAgentSessions.setState({
      currentSessionId: "s1",
      connected: true,
      views: {
        s1: {
          session_id: "s1", title: "t", status: "active", permission_mode: "controlled", provider: null, model: null, phase: "idle",
          messages: [{ role: "user", content: [{ type: "text", text: '<skill name="imt-protocol" location="/u/SKILL.md">\nSECRET BODY\n</skill>\n\nleft side' }] }],
          context_usage: null, created_at: "", updated_at: "", project_id: null,
        },
      },
    });
    render(<I18nProvider><AgentConversation /></I18nProvider>);
    expect(screen.getByTestId("skill-call")).toHaveTextContent("Skill: imt-protocol");
    expect(screen.getByTestId("skill-call")).toHaveTextContent("left side");
    expect(screen.queryByText(/SECRET BODY/u)).toBeNull();
  });
});
