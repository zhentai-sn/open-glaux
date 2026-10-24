import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../../i18n";
import { activityFor, formatWait, TurnActivity } from "./TurnActivity";

function call(name: string, args: Record<string, unknown> = {}, id = "c1") {
  return { role: "assistant", content: [{ type: "toolCall", id, name, arguments: args }] };
}

function result(id = "c1") {
  return { role: "toolResult", toolCallId: id, content: [{ type: "text", text: "ok" }] };
}

const base = { running: true, waitingOnUser: false, streamingText: "" };

beforeEach(() => {
  localStorage.setItem("glaux.lang", "en");
});

describe("activityFor", () => {
  it("没有工具调用时显示思考", () => {
    expect(activityFor({ ...base, messages: [] })).toEqual({ key: "agent_wait_thinking" });
  });

  it("读/写/改带上文件名", () => {
    expect(activityFor({ ...base, messages: [call("read", { path: "/p/atlas.py" })] })).toEqual({
      key: "agent_wait_reading",
      vars: { file: "atlas.py" },
    });
    expect(activityFor({ ...base, messages: [call("write", { path: "metrics.json" })] })).toEqual({
      key: "agent_wait_writing",
      vars: { file: "metrics.json" },
    });
    expect(activityFor({ ...base, messages: [call("edit", { path: "a/b.py" })] })).toEqual({
      key: "agent_wait_editing",
      vars: { file: "b.py" },
    });
  });

  it("通用工具按名称映射，未知工具回落调用名", () => {
    expect(activityFor({ ...base, messages: [call("run_task")] })).toEqual({ key: "agent_wait_task" });
    expect(activityFor({ ...base, messages: [call("bash")] })).toEqual({ key: "agent_wait_bash" });
    expect(activityFor({ ...base, messages: [call("mystery")] })).toEqual({
      key: "agent_wait_tool",
      vars: { tool: "mystery" },
    });
  });

  it("调用已有结果且无流式正文时显示整理结果", () => {
    expect(activityFor({ ...base, messages: [call("read"), result()] })).toEqual({
      key: "agent_wait_composing",
    });
  });

  it("流式正文、等待用户或未运行时不出等待行", () => {
    expect(activityFor({ ...base, messages: [], streamingText: "text" })).toBeNull();
    expect(activityFor({ ...base, messages: [], waitingOnUser: true })).toBeNull();
    expect(activityFor({ ...base, running: false, messages: [] })).toBeNull();
  });
});

describe("formatWait", () => {
  it("不足一分钟给秒，超过给 m ss", () => {
    expect(formatWait(2_400)).toBe("2s");
    expect(formatWait(65_000)).toBe("1m 05s");
  });
});

describe("TurnActivity", () => {
  it("运行时渲染等待文案", () => {
    render(
      <I18nProvider>
        <TurnActivity messages={[]} running waitingOnUser={false} streamingText="" />
      </I18nProvider>,
    );
    expect(screen.getByTestId("turn-activity")).toHaveTextContent("Thinking…");
  });

  it("没有可显示的状态时返回空", () => {
    const { container } = render(
      <I18nProvider>
        <TurnActivity messages={[]} running={false} waitingOnUser={false} streamingText="" />
      </I18nProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
