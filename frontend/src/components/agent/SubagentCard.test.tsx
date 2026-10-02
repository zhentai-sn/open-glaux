// SDD 18 §5.1、§9.2：子智能体卡片的解析与呈现。
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { messageToolResultDetails } from "../../agent/runtime/events";
import { I18nProvider } from "../../i18n";
import { SubagentCard, parseSubagentRun } from "./SubagentCard";

const details = {
  kind: "glaux.subagent_run",
  subagent_type: "general",
  description: "find the reports",
  outcome: "completed",
  turns: 2,
  final: "Found **3** reports.",
  transcript: [
    { role: "user", content: "List the reports" },
    { role: "assistant", content: [{ type: "toolCall", id: "c1", name: "list_files", arguments: {} }] },
    { role: "toolResult", toolCallId: "c1", toolName: "list_files", content: [{ type: "text", text: "a.md b.md c.md" }], isError: false },
    { role: "assistant", content: [{ type: "text", text: "Found 3 reports." }] },
  ],
};

function renderCard(value: unknown = details) {
  return render(<I18nProvider><SubagentCard payload={parseSubagentRun(value)!} /></I18nProvider>);
}

describe("SubagentCard", () => {
  beforeEach(() => localStorage.setItem("glaux.lang", "en"));

  it("rejects details of other shapes", () => {
    expect(parseSubagentRun({ ...details, kind: "glaux.file_read" })).toBeNull();
    expect(parseSubagentRun({ ...details, outcome: "weird" })).toBeNull();
  });

  it("shows the task, definition, outcome, turns and final reply, with steps collapsed", () => {
    renderCard();
    expect(screen.getByText("find the reports")).toBeInTheDocument();
    expect(screen.getByText("general")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("2 turns")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    const summary = screen.getByText("Steps (4)");
    expect(summary.closest("details")).not.toHaveAttribute("open");
    fireEvent.click(summary);
    expect(screen.getByText("a.md b.md c.md")).toBeInTheDocument();
    expect(screen.getByText(/→ list_files/u)).toBeInTheDocument();
  });

  it("marks unfinished runs and an empty reply", () => {
    renderCard({ ...details, outcome: "budget_exceeded", final: "", transcript: [] });
    expect(screen.getByText("Out of budget")).toBeInTheDocument();
    expect(screen.getByText("The sub-agent gave no reply.")).toBeInTheDocument();
    expect(screen.queryByText(/Steps/u)).toBeNull();
  });

  it("keeps the card of a failed sub-agent while hiding other failed tool results", () => {
    const failed = { ...details, outcome: "failed" };
    expect(messageToolResultDetails({ role: "toolResult", isError: true, details: failed })).toEqual(failed);
    expect(messageToolResultDetails({ role: "toolResult", isError: true, details: { kind: "glaux.file_read" } })).toBeNull();
  });
});
