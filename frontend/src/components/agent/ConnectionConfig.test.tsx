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

async function waitForModelOption(modelId: string) {
  await waitFor(() => {
    const options = Array.from(document.querySelectorAll<HTMLOptionElement>("datalist option"));
    expect(options.some((option) => option.value === modelId)).toBe(true);
  });
}

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
    await waitForModelOption("big");

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
    await waitForModelOption("small");

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
    await waitForModelOption("bare");

    fireEvent.change(screen.getByLabelText("模型（可选）"), { target: { value: "bare" } });
    expect(numberField("上下文窗口").value).toBe("65536");
    expect(numberField("最大输出 Token").value).toBe(String(DEFAULT_MAX_TOKENS));
  });

  it("拉取模型后仍可输入列表外的自定义模型 ID，并保留当前元数据", async () => {
    vi.spyOn(agentRuntimeApi, "listModels").mockResolvedValue({
      models: [{ id: "listed", vision: "unknown", context_window: 200_000, max_tokens: 16_384 }],
    });
    setup();
    fireEvent.change(numberField("上下文窗口"), { target: { value: "65536" } });
    fireEvent.change(numberField("最大输出 Token"), { target: { value: "4096" } });
    fireEvent.click(screen.getByRole("button", { name: "拉取模型" }));
    await waitForModelOption("listed");

    const modelField = screen.getByLabelText("模型（可选）") as HTMLInputElement;
    fireEvent.change(modelField, { target: { value: "MiniMaxAI/MiniMax-M3" } });

    expect(modelField.value).toBe("MiniMaxAI/MiniMax-M3");
    expect(useSession.getState().connection.model).toBe("MiniMaxAI/MiniMax-M3");
    expect(numberField("上下文窗口").value).toBe("65536");
    expect(numberField("最大输出 Token").value).toBe("4096");
  });

  it("再次拉取模型列表不会覆盖当前自定义模型 ID", async () => {
    vi.spyOn(agentRuntimeApi, "listModels").mockResolvedValue({
      models: [{ id: "listed", vision: "unknown" }],
    });
    useSession.getState().setConnection({ model: "custom/model" });
    setup();

    fireEvent.click(screen.getByRole("button", { name: "拉取模型" }));
    await waitForModelOption("listed");

    expect((screen.getByLabelText("模型（可选）") as HTMLInputElement).value).toBe(
      "custom/model",
    );
    expect(useSession.getState().connection.model).toBe("custom/model");
  });
});

describe("ConnectionConfig · 状态卡与分组（SDD feats/01 D26）", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("glaux.lang", "zh");
    useSession.getState().setConnection({
      provider: "openai_compatible",
      baseUrl: "",
      apiKey: "",
      model: "",
      mediaAdapter: "none",
      contextWindow: DEFAULT_CONTEXT_WINDOW,
      maxTokens: DEFAULT_MAX_TOKENS,
      models: undefined,
      lastTest: undefined,
    });
  });

  const status = () => screen.getByRole("status");

  it("未填地址 → 尚未配置；填了未测 → 未测试", () => {
    setup();
    expect(status()).toHaveTextContent("尚未配置");
    expect(status()).toHaveTextContent("填写服务地址后测试连接");
    fireEvent.change(screen.getByLabelText("服务地址"), { target: { value: "http://localhost:1234/v1" } });
    expect(status()).toHaveTextContent("未测试");
  });

  it("测试通过 → 已连接；再改模型 → 结论失效回到未测试", async () => {
    vi.spyOn(agentRuntimeApi, "testConnection").mockResolvedValue({ ok: true, model_count: 3 } as never);
    useSession.getState().setConnection({ baseUrl: "http://localhost:1234/v1", model: "m1" });
    setup();
    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
    await waitFor(() => expect(status()).toHaveTextContent("已连接 · m1"));
    expect(screen.getByRole("button", { name: "重新测试" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("模型（可选）"), { target: { value: "m2" } });
    expect(status()).toHaveTextContent("未测试");
    expect(useSession.getState().connection.lastTest).toBeUndefined();
  });

  it("测试抛错 → 连接失败并显示原因", async () => {
    vi.spyOn(agentRuntimeApi, "testConnection").mockRejectedValue(new Error("ECONNREFUSED"));
    useSession.getState().setConnection({ baseUrl: "http://localhost:1234/v1" });
    setup();
    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
    await waitFor(() => expect(status()).toHaveTextContent("连接失败"));
    expect(status()).toHaveTextContent("ECONNREFUSED");
  });

  it("密钥可切换明文；切到 Anthropic 隐藏服务地址、能力与高级", () => {
    setup();
    const key = screen.getByLabelText("API 密钥") as HTMLInputElement;
    expect(key.type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "显示密钥" }));
    expect(key.type).toBe("text");

    expect(screen.getByLabelText("服务地址")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Anthropic" }));
    expect(useSession.getState().connection.provider).toBe("anthropic");
    expect(screen.queryByLabelText("服务地址")).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "音视频理解" })).toBeNull();
    expect(screen.queryByLabelText("上下文窗口")).toBeNull();
  });

  it("最大输出不小于上下文窗口 → 高级组自动展开并标红", () => {
    useSession.getState().setConnection({ contextWindow: 4096, maxTokens: 8192 });
    setup();
    expect(document.querySelector("details.cfg-advanced")).toHaveAttribute("open");
    expect(screen.getByLabelText("最大输出 Token")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("最大输出须小于上下文窗口。")).toBeInTheDocument();
  });
});
