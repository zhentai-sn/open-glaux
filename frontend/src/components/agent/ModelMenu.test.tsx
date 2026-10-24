import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { agentRuntimeApi } from "../../agent/runtime/client";
import type { SessionView } from "../../agent/runtime/types";
import { I18nProvider } from "../../i18n";
import { useAgentSessions } from "../../store/agentSessions";
import { DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS, useSession } from "../../store/session";
import { ModelMenu } from "./ModelMenu";

const session: SessionView = {
  session_id: "019c0000-0000-7000-8000-000000000002",
  title: "t",
  status: "active",
  permission_mode: "controlled",
  provider: "opencode",
  model: "deepseek-v4.1-flash",
  phase: "idle",
  messages: [],
  context_usage: null,
  created_at: "2026-10-24T00:00:00.000Z",
  updated_at: "2026-10-24T00:00:00.000Z",
  project_id: null,
};

function setup(props: Partial<Parameters<typeof ModelMenu>[0]> = {}) {
  render(
    <I18nProvider>
      <ModelMenu sessionId={session.session_id} running={false} onMore={() => {}} {...props} />
    </I18nProvider>,
  );
}

describe("ModelMenu", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("glaux.lang", "zh");
    useSession.getState().setConnection({
      provider: "opencode",
      baseUrl: "",
      apiKey: "sk-test",
      model: "deepseek-v4.1-flash",
      contextWindow: 1_000_000,
      maxTokens: 32_768,
      thinkingLevel: "off",
      models: [
        { id: "deepseek-v4.1-flash", vision: "unknown", context_window: 1_000_000, max_tokens: 32_768 },
        { id: "deepseek-v4-pro", vision: "unknown", context_window: 200_000, max_tokens: 16_384 },
      ],
    });
    vi.spyOn(agentRuntimeApi, "patchSession").mockResolvedValue(session);
  });

  it("列出已获取的模型并标出当前项", () => {
    setup();
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: /deepseek-v4\.1-flash/ })).toHaveTextContent("1M · 33K");
  });

  it("换模型：写连接（含元数据）并同步会话绑定", async () => {
    setup();
    fireEvent.click(screen.getByRole("option", { name: /deepseek-v4-pro/ }));
    expect(useSession.getState().connection.model).toBe("deepseek-v4-pro");
    // 上游自报的窗口与输出上限一并写入
    expect(useSession.getState().connection.contextWindow).toBe(200_000);
    expect(useSession.getState().connection.maxTokens).toBe(16_384);
    await waitFor(() => {
      expect(agentRuntimeApi.patchSession).toHaveBeenCalledWith(
        session.session_id,
        { provider: "opencode", model: "deepseek-v4-pro" },
      );
    });
  });

  it("推理等级四档，点击写连接", () => {
    setup();
    expect(screen.getByRole("radio", { name: "关闭" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "高" }));
    expect(useSession.getState().connection.thinkingLevel).toBe("high");
    expect(screen.getByRole("radio", { name: "高" })).toHaveAttribute("aria-checked", "true");
  });

  it("方向键在档位间移动", () => {
    setup();
    const radio = screen.getByRole("radio", { name: "关闭" });
    fireEvent.keyDown(radio, { key: "ArrowRight" });
    expect(useSession.getState().connection.thinkingLevel).toBe("low");
    fireEvent.keyDown(radio, { key: "ArrowLeft" });
    expect(useSession.getState().connection.thinkingLevel).toBe("off");
  });

  it("没有模型列表时提供一次拉取", async () => {
    useSession.getState().setConnection({ models: undefined, contextWindow: DEFAULT_CONTEXT_WINDOW, maxTokens: DEFAULT_MAX_TOKENS });
    const list = vi.spyOn(agentRuntimeApi, "listModels").mockResolvedValue({
      models: [{ id: "auto-model", vision: "unknown", context_window: 64_000 }],
    });
    setup();
    fireEvent.click(screen.getByRole("button", { name: "获取模型列表" }));
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(await screen.findByRole("option", { name: /auto-model/ })).toBeInTheDocument();
  });

  it("更多模型走回调", () => {
    const onMore = vi.fn();
    setup({ onMore });
    fireEvent.click(screen.getByRole("button", { name: "更多模型" }));
    expect(onMore).toHaveBeenCalled();
  });

  it("运行中不 patch 会话（runtime 会 409）", () => {
    useAgentSessions.setState({ sessions: [] });
    setup({ running: true });
    fireEvent.click(screen.getByRole("option", { name: /deepseek-v4-pro/ }));
    expect(agentRuntimeApi.patchSession).not.toHaveBeenCalled();
  });
});
