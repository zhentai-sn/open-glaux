import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { agentRuntimeApi } from "../../agent/runtime/client";
import { I18nProvider } from "../../i18n";
import { DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS, useSession } from "../../store/session";
import { ConnectionConfig } from "./ConnectionConfig";

// SDD 00 §4：上下文窗口 / 最大输出对用户是「预填可改」——探到上游元数据用上游值，
// 探不到落默认值；两个字段始终显式带值，runtime 侧的必填契约不受影响。

function setup() {
  render(
    <I18nProvider>
      <ConnectionConfig onClose={() => {}} />
    </I18nProvider>,
  );
}

const numberField = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

describe("ConnectionConfig · 上下文元数据预填", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("glaux.lang", "zh");
    useSession.getState().setConnection({
      provider: "openai_compatible",
      baseUrl: "http://localhost:1234/v1",
      apiKey: "",
      model: "",
      contextWindow: DEFAULT_CONTEXT_WINDOW,
      maxTokens: DEFAULT_MAX_TOKENS,
      models: undefined,
    });
  });

  it("默认就带值，用户不填任何数字", () => {
    setup();
    expect(numberField("上下文窗口").value).toBe(String(DEFAULT_CONTEXT_WINDOW));
    expect(numberField("最大输出 Token").value).toBe(String(DEFAULT_MAX_TOKENS));
  });

  it("选中带元数据的模型 → 用上游自报值覆盖", async () => {
    vi.spyOn(agentRuntimeApi, "listModels").mockResolvedValue({
      models: [
        { id: "big", vision: "unknown", context_window: 200_000, max_tokens: 16_384 },
        { id: "small", vision: "unknown", context_window: 8192 },
        { id: "bare", vision: "unknown" },
      ],
    });
    setup();
    fireEvent.click(screen.getByRole("button", { name: "拉取模型" }));
    await waitFor(() => expect(screen.getByLabelText("模型（可选）")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("模型（可选）"), { target: { value: "big" } });
    expect(numberField("上下文窗口").value).toBe("200000");
    expect(numberField("最大输出 Token").value).toBe("16384");
  });

  it("上游只报窗口且比默认输出还小 → 输出按 1/4 收窄，不会撞 max_tokens < context_window", async () => {
    vi.spyOn(agentRuntimeApi, "listModels").mockResolvedValue({
      models: [{ id: "small", vision: "unknown", context_window: 8192 }],
    });
    setup();
    fireEvent.click(screen.getByRole("button", { name: "拉取模型" }));
    await waitFor(() => expect(screen.getByLabelText("模型（可选）")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("模型（可选）"), { target: { value: "small" } });
    expect(numberField("上下文窗口").value).toBe("8192");
    expect(numberField("最大输出 Token").value).toBe("2048");
  });

  it("上游没有元数据 → 保留当前值（默认或用户手改的）", async () => {
    vi.spyOn(agentRuntimeApi, "listModels").mockResolvedValue({
      models: [{ id: "bare", vision: "unknown" }],
    });
    setup();
    fireEvent.change(numberField("上下文窗口"), { target: { value: "65536" } });
    fireEvent.click(screen.getByRole("button", { name: "拉取模型" }));
    await waitFor(() => expect(screen.getByLabelText("模型（可选）")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("模型（可选）"), { target: { value: "bare" } });
    expect(numberField("上下文窗口").value).toBe("65536");
    expect(numberField("最大输出 Token").value).toBe(String(DEFAULT_MAX_TOKENS));
  });
});
