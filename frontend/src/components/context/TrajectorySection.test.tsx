// SDD 21 §15.2：轨迹分区的记录表、时间线、详情、按需请求与刷新。
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { agentRuntimeApi, AgentRuntimeError } from "../../agent/runtime/client";
import type { RequestHeaderBody, Trajectory } from "../../agent/runtime/types";
import { I18nProvider } from "../../i18n";
import { useAgentSessions } from "../../store/agentSessions";
import { TrajectorySection } from "./TrajectorySection";

const H1: RequestHeaderBody = {
  prompt: "base viewer",
  segments: [
    { kind: "base", text: "base", est_tokens: 40 },
    { kind: "viewer", text: "No image.", est_tokens: 5 },
  ],
  tools: [{ name: "bash", plugin: "files", effect: "exec", description: "Run.", parameters: {}, est_tokens: 20 }],
  est_tokens: { prompt: 45, tools: 20 },
};
const H2: RequestHeaderBody = {
  ...H1,
  segments: [...H1.segments, { kind: "instructions", scope: "user", text: "Use mm.", est_tokens: 3 }],
  tools: [...H1.tools, { name: "read", plugin: "files", effect: "read", description: "Read.", parameters: {}, est_tokens: 8 }],
  est_tokens: { prompt: 48, tools: 28 },
};
const usage = { input: 100, output: 20, cacheRead: 10, cacheWrite: 0 };

const TRAJECTORY: Trajectory = {
  session_id: "s1",
  headers: { h1: H1, h2: H2 },
  totals: { turns: 2, model_calls: 3, tool_calls: 1, usage: { input: 300, output: 60, cache_read: 30, cache_write: 0 } },
  turns: [
    {
      index: 1, command_id: "c1", command_type: "prompt", started_at: 1000, ended_at: 4000, outcome: "completed",
      items: [
        { kind: "header", item_id: "hd1", at: 1000, hash: "h1", provider: "p", model: "m", context_window: 1000, lang: "en", permission_mode: "controlled", changed: "initial" },
        { kind: "user", item_id: "u1", at: 1001, content: [{ type: "text", text: "list files\nplease" }] },
        {
          kind: "model", item_id: "m1", at: 1002, step: 1, stop_reason: "toolUse", usage,
          content: [{ type: "thinking", text: "plan" }, { type: "toolCall", id: "t1", name: "agent", arguments: { prompt: "scan" } }],
          timing: { started_at: 1002, first_token_ms: 300, duration_ms: 1200 },
          request: { message_count: 1, pruned_images: 0, injected_count: 0, est_tokens: { system: 45, tools: 20, messages: 35 } },
        },
        {
          kind: "tool", item_id: "t1r", at: 1003, tool_call_id: "t1", name: "agent", arguments: { prompt: "scan" },
          result: [{ type: "text", text: "found 3" }], is_error: false, blocked: false, duration_ms: 2500, waited_ms: 500,
          subagent: { subagent_type: "explore", description: "scan", outcome: "completed", turns: 2, transcript: [{ role: "assistant", content: [{ type: "text", text: "sub reply" }] }] },
        },
        { kind: "model", item_id: "m2", at: 1004, step: 2, stop_reason: "stop", usage, content: [{ type: "text", text: "There are 3 files." }] },
      ],
    },
    {
      index: 2, command_id: "c2", started_at: 5000, outcome: "running",
      items: [
        { kind: "header", item_id: "hd2", at: 5000, hash: "h2", provider: "p", model: "m", context_window: 1000, lang: "en", permission_mode: "controlled", changed: "changed" },
        { kind: "notice", item_id: "n1", at: 5001, type: "permission", data: { tool: "bash", decision: "deny" } },
        { kind: "model", item_id: "m3", at: 5002, step: 1, stop_reason: "error", error_message: "boom", usage, content: [] },
      ],
    },
  ],
};

function setSession(sessionId: string | null, phase: string = "idle") {
  useAgentSessions.setState({
    currentSessionId: sessionId,
    sessions: [],
    views: sessionId ? { [sessionId]: { session_id: sessionId, phase } as never } : {},
  });
}

const renderSection = () => render(<I18nProvider><TrajectorySection /></I18nProvider>);
const rows = () => screen.getAllByRole("button", { expanded: false }).filter((b) => b.classList.contains("traj-row-head"));
const row = (id: string) => document.getElementById(`traj-row-${id}`)!;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("glaux.lang", "en");
  setSession("s1");
});
afterEach(() => vi.restoreAllMocks());

describe("TrajectorySection", () => {
  it("asks for a session when none is open", () => {
    setSession(null);
    renderSection();
    expect(screen.getByText("Open or start a conversation to see its trajectory.")).toBeInTheDocument();
  });

  it("lists turns with badges, summaries and durations, and folds turns and calls", async () => {
    vi.spyOn(agentRuntimeApi, "getTrajectory").mockResolvedValue(TRAJECTORY);
    renderSection();
    expect(await screen.findByTestId("traj-totals")).toHaveTextContent("2 turns · 3 model calls · 1 tool calls · in 300 / out 60 / cache read 30 tokens");
    expect(screen.getByRole("button", { name: /Turn 1/u })).toHaveTextContent("Completed");
    expect(screen.getByRole("button", { name: /Turn 2/u })).toHaveTextContent("Running");
    expect(within(row("hd1")).getByText("System prompt ≈45 tokens · 1 tools · first turn")).toBeInTheDocument();
    expect(within(row("hd2")).getByText(/changed$/u)).toBeInTheDocument();
    expect(within(row("u1")).getByText("list files")).toBeInTheDocument();
    expect(within(row("m1")).getByText("Calls 1 tools")).toBeInTheDocument();
    expect(within(row("m1")).getByText("1.20s")).toBeInTheDocument();
    expect(within(row("t1r")).getByText('agent {"prompt":"scan"} → found 3')).toBeInTheDocument();
    expect(within(row("n1")).getByText("Permission denied: bash")).toBeInTheDocument();
    expect(rows()).toHaveLength(8);

    fireEvent.click(screen.getByRole("button", { name: "Calls" }));
    expect(screen.getByRole("button", { name: "Calls" })).toHaveAttribute("aria-pressed", "true");
    expect(document.getElementById("traj-row-t1r")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Turns" }));
    expect(screen.queryByText("list files")).toBeNull();
    expect(screen.getByRole("button", { name: /Turn 1/u })).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "Turns" }));
    expect(screen.getByText("list files")).toBeInTheDocument();
  });

  it("draws three equal-width lanes and jumps to the clicked record", async () => {
    vi.spyOn(agentRuntimeApi, "getTrajectory").mockResolvedValue(TRAJECTORY);
    renderSection();
    const timeline = await screen.findByRole("group", { name: "Timeline" });
    const blocks = timeline.querySelectorAll(".traj-block");
    expect(blocks).toHaveLength(8);
    expect(timeline.querySelectorAll(".traj-lane-tool")).toHaveLength(1);
    expect(timeline.querySelectorAll(".traj-lane-model")).toHaveLength(3);
    expect(timeline.querySelectorAll(".traj-block.warn")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Calls" }));
    fireEvent.click(screen.getByRole("button", { name: "Turns" }));
    fireEvent.click(within(timeline).getByRole("button", { name: /^Tool: agent/u }));
    expect(within(row("t1r")).getByRole("button", { expanded: true })).toBeInTheDocument();
    expect(within(row("t1r")).getByRole("tab", { name: "Arguments" })).toHaveAttribute("aria-selected", "true");
  });

  it("shows header segments, tools and the diff against the previous turn", async () => {
    vi.spyOn(agentRuntimeApi, "getTrajectory").mockResolvedValue(TRAJECTORY);
    renderSection();
    fireEvent.click(within(await screen.findByTestId("ctx-trajectory")).getByText(/changed$/u));
    const detail = row("hd2");
    expect(within(detail).getByText("Personal GLAUX.md")).toBeInTheDocument();
    fireEvent.click(within(detail).getByRole("tab", { name: "Tools" }));
    expect(within(detail).getByText("read")).toBeInTheDocument();
    fireEvent.click(within(detail).getByRole("tab", { name: "Diff" }));
    const diff = within(detail).getByTestId("traj-diff");
    expect(diff).toHaveTextContent("Added Personal GLAUX.md");
    expect(diff).toHaveTextContent("≈+3 tokens");
    expect(diff).toHaveTextContent("Added read");

    fireEvent.click(within(row("hd1")).getByRole("button"));
    fireEvent.click(within(row("hd1")).getByRole("tab", { name: "Diff" }));
    expect(within(row("hd1")).getByText("No previous turn to compare with.")).toBeInTheDocument();
  });

  it("shows model output, usage with context occupancy, timing and the lazily rebuilt request", async () => {
    vi.spyOn(agentRuntimeApi, "getTrajectory").mockResolvedValue(TRAJECTORY);
    const request = vi.spyOn(agentRuntimeApi, "getRequestContext").mockResolvedValue({
      item_id: "m1", header_hash: "h1", turn_index: 1, matched: false, recorded_count: 2,
      messages: [{ role: "user", content: [{ type: "text", text: "list files" }], est_tokens: 3, marks: ["pruned"] }],
    });
    renderSection();
    fireEvent.click(within(await screen.findByTestId("ctx-trajectory")).getByText("Calls 1 tools"));
    const detail = row("m1");
    expect(within(detail).getByText("Thinking")).toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();

    fireEvent.click(within(detail).getByRole("tab", { name: "Usage" }));
    expect(within(detail).getByText("Total ≈100 tokens, 10% of the 1000-token context window")).toBeInTheDocument();
    fireEvent.click(within(detail).getByRole("tab", { name: "Timing" }));
    expect(within(detail).getByText("300ms")).toBeInTheDocument();
    expect(within(detail).getByText("900ms")).toBeInTheDocument();

    fireEvent.click(within(detail).getByRole("tab", { name: "Request" }));
    const panel = await within(detail).findByTestId("traj-request");
    expect(request).toHaveBeenCalledWith("s1", "m1");
    expect(within(panel).getByRole("status")).toHaveTextContent("rebuilt 1, sent 2");
    expect(within(panel).getByText("Pruned")).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "System prompt and tools: see the context of turn 1" }));
    expect(within(row("hd1")).getByRole("tab", { name: "Segments" })).toBeInTheDocument();
  });

  it("nests the sub-agent transcript under the agent tool", async () => {
    vi.spyOn(agentRuntimeApi, "getTrajectory").mockResolvedValue(TRAJECTORY);
    renderSection();
    fireEvent.click(within(await screen.findByTestId("ctx-trajectory")).getByText('agent {"prompt":"scan"} → found 3'));
    fireEvent.click(within(row("t1r")).getByRole("tab", { name: "Timing" }));
    expect(within(row("t1r")).getByText("500ms")).toBeInTheDocument();
    fireEvent.click(within(row("t1r")).getByRole("tab", { name: "Sub-agent" }));
    expect(within(row("t1r")).getByText("sub reply")).toBeInTheDocument();
  });

  it("refetches when the session phase changes and keeps expanded rows", async () => {
    const get = vi.spyOn(agentRuntimeApi, "getTrajectory").mockResolvedValue(TRAJECTORY);
    setSession("s1", "running");
    renderSection();
    fireEvent.click(within(await screen.findByTestId("ctx-trajectory")).getByText("There are 3 files."));
    expect(get).toHaveBeenCalledTimes(1);
    act(() => setSession("s1", "idle"));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(within(row("m2")).getByRole("tab", { name: "Output" })).toBeInTheDocument();
  });

  it("shows errors and an outdated runtime", async () => {
    vi.spyOn(agentRuntimeApi, "getTrajectory").mockRejectedValueOnce(new AgentRuntimeError(500, "internal", "boom"));
    const { unmount } = renderSection();
    expect(await screen.findByRole("alert")).toHaveTextContent("internal: boom");
    unmount();
    vi.spyOn(agentRuntimeApi, "getTrajectory").mockRejectedValueOnce(new AgentRuntimeError(404, "not_found", "route"));
    renderSection();
    expect(await screen.findByRole("alert")).toHaveTextContent("The agent runtime is older than this page");
  });
});
