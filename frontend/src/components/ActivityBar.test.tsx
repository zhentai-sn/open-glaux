// SDD 19 §7.1 规则 4：Workbench 活动栏只有一个「上下文」入口，侧边栏内渲染同一上下文页。
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { agentRuntimeApi } from "../agent/runtime/client";
import { I18nProvider } from "../i18n";
import { useSession } from "../store/session";
import { ActivityBar } from "./ActivityBar";
import { SideBar } from "./SideBar";

beforeEach(() => {
  localStorage.setItem("glaux.lang", "en");
  vi.spyOn(agentRuntimeApi, "listResources").mockResolvedValue({ skills: [], templates: [], instructions: [], diagnostics: [] });
  vi.spyOn(agentRuntimeApi, "getInstructions").mockResolvedValue({ scope: "user", path: "/u/GLAUX.md", content: "" });
  useSession.setState({ sidebarView: "explorer" });
});
afterEach(() => vi.restoreAllMocks());

describe("Workbench context entry", () => {
  it("replaces the skills and prompts views with one context view", async () => {
    render(<I18nProvider><ActivityBar /><SideBar /></I18nProvider>);
    expect(screen.queryByText("Skills")).toBeNull();
    expect(screen.queryByText("Prompts")).toBeNull();
    fireEvent.click(screen.getByText("Context").closest("button")!);
    expect(useSession.getState().sidebarView).toBe("context");
    expect(await screen.findByTestId("context-panel")).toBeInTheDocument();
  });
});
