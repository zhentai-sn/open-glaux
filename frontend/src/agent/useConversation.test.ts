import { describe, expect, it } from "vitest";

import type { Connection } from "../store/session";
import { toConnectionInput } from "./useConversation";

const base: Connection = {
  provider: "opencode",
  baseUrl: "",
  apiKey: "sk-test",
  model: "deepseek-v4.1-flash",
  contextWindow: 200_000,
  maxTokens: 32_768,
};

describe("toConnectionInput", () => {
  it("推理档位随发送命令下发，未设置时不带字段", () => {
    expect(toConnectionInput({ ...base, thinkingLevel: "high" }).thinking_level).toBe("high");
    expect(toConnectionInput(base)).not.toHaveProperty("thinking_level");
  });

  it("前端枚举转成 runtime 的连字符写法", () => {
    expect(toConnectionInput({ ...base, provider: "openai_compatible" }).provider).toBe("openai-compatible");
    expect(toConnectionInput({ ...base, provider: "deepseek" }).provider).toBe("deepseek");
  });
});
