import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InteractionRequest } from "../../agent/runtime/types";
import { I18nProvider } from "../../i18n";
import { InteractionCard, ResolvedInteractionLine } from "./InteractionCard";

const base = {
  request_id: "r1",
  session_id: "s1",
  command_id: "c1",
  created_at: "2026-10-02T00:00:00.000Z",
  expires_at: "2026-10-02T00:30:00.000Z",
};

const permission = (grant_options: ("once" | "session" | "always")[]): InteractionRequest => ({
  ...base,
  kind: "permission",
  permission: { tool_call_id: "t1", tool_name: "run_task", effect: "compute", args_summary: '{"image_id":"x"}', grant_options },
});

const question = (options: string[], allow_free_text = true): InteractionRequest => ({
  ...base,
  kind: "question",
  question: { question: "Which side?", options, allow_free_text },
});

function renderCard(request: InteractionRequest) {
  const onReply = vi.fn();
  render(<I18nProvider><InteractionCard request={request} onReply={onReply} /></I18nProvider>);
  return onReply;
}

describe("InteractionCard", () => {
  beforeEach(() => localStorage.setItem("glaux.lang", "en"));

  it("offers the grant options of the request plus deny with an optional reason", () => {
    const onReply = renderCard(permission(["once", "session", "always"]));
    expect(screen.getByText("run_task needs your approval")).toBeInTheDocument();
    expect(screen.getByText("compute")).toBeInTheDocument();
    expect(screen.getByText('{"image_id":"x"}')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Reason (optional)"), { target: { value: "too slow" } });
    fireEvent.click(screen.getByTestId("interaction-deny"));
    expect(onReply).toHaveBeenCalledWith({ kind: "permission", decision: "deny", reason: "too slow" });
    expect(screen.getByTestId("interaction-once")).toBeDisabled();
  });

  it("only offers 'allow once' for requests raised by an ask rule", () => {
    const onReply = renderCard(permission(["once"]));
    expect(screen.queryByTestId("interaction-session")).toBeNull();
    expect(screen.queryByTestId("interaction-always")).toBeNull();
    fireEvent.click(screen.getByTestId("interaction-once"));
    expect(onReply).toHaveBeenCalledWith({ kind: "permission", decision: "once" });
  });

  it("answers a question by option or by free text", () => {
    const onReply = renderCard(question(["left", "right"]));
    fireEvent.click(screen.getByTestId("interaction-option-1"));
    expect(onReply).toHaveBeenCalledWith({ kind: "question", option: 1 });
  });

  it("submits trimmed free text and hides the input when free text is not allowed", () => {
    const onReply = renderCard(question([]));
    fireEvent.change(screen.getByLabelText("Type an answer"), { target: { value: "  the left one " } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onReply).toHaveBeenCalledWith({ kind: "question", text: "the left one" });
  });

  it("collapses a resolved request into one line", () => {
    render(
      <I18nProvider>
        <ResolvedInteractionLine item={{ request: permission(["once"]), outcome: "answered", reply: { kind: "permission", decision: "deny" } }} />
        <ResolvedInteractionLine item={{ request: question(["a"]), outcome: "expired" }} />
      </I18nProvider>,
    );
    expect(screen.getByText("Denied")).toBeInTheDocument();
    expect(screen.getByText("Expired")).toBeInTheDocument();
  });

  it("marks a permission request answered elsewhere as handled", () => {
    render(<I18nProvider><ResolvedInteractionLine item={{ request: permission(["once"]), outcome: "answered" }} /></I18nProvider>);
    expect(screen.getByText("Handled")).toBeInTheDocument();
  });
  it("names the sub-agent a request comes from", () => {
    renderCard({ ...permission(["once"]), origin: { subagent: "find the reports" } });
    expect(screen.getByTestId("interaction-origin")).toHaveTextContent("From sub-agent: find the reports");
    renderCard({ ...question([]), origin: { subagent: "check units" } });
    expect(screen.getAllByTestId("interaction-origin")[1]).toHaveTextContent("From sub-agent: check units");
  });

  it("shows no origin for requests of the main agent", () => {
    renderCard(permission(["once"]));
    expect(screen.queryByTestId("interaction-origin")).toBeNull();
  });
});
