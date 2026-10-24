/**
 * OpenCode 托管端点要求 `x-opencode-session`（缺失即 400 MissingSessionID）。
 * 这里锁定「只发给 opencode.ai、值随会话稳定、显式配置优先」三条边界。
 */
import { describe, expect, it } from "vitest";

import {
  isOpencodeEndpoint,
  resolveOpencodeSessionHeaders,
} from "../../src/pi/opencode-session.js";

const MODEL = { baseUrl: "https://opencode.ai/zen/v1" } as const;

describe("OpenCode 会话头", () => {
  it.each([
    "https://proxy.example/zen/v1",
    "https://opencode.ai.example/zen/v1",
    "https://opencode.ai@proxy.example/zen/v1",
    "https://unrelated.opencode.ai/zen/v1",
    "http://opencode.ai/zen/v1",
    "not a URL",
    "",
  ])("不向 %s 发送会话标识", (baseUrl) => {
    const headers = { "X-Custom": "keep" };
    expect(resolveOpencodeSessionHeaders({ baseUrl }, { sessionId: "conversation", headers })).toBe(
      headers,
    );
    expect(isOpencodeEndpoint(baseUrl)).toBe(false);
  });

  it("同一会话稳定、不同会话互不相同", () => {
    const first = resolveOpencodeSessionHeaders({ baseUrl: "https://OPENCODE.AI./zen/go/v1" }, {
      sessionId: "conversation-a",
    });
    expect(first).toEqual({ "x-opencode-session": "conversation-a" });
    expect(
      resolveOpencodeSessionHeaders({ baseUrl: "https://opencode.ai/zen/go/v1" }, {
        sessionId: "conversation-a",
      }),
    ).toEqual(first);
    expect(
      resolveOpencodeSessionHeaders({ baseUrl: "https://opencode.ai/zen/go/v1" }, {
        sessionId: "conversation-b",
      }),
    ).toEqual({ "x-opencode-session": "conversation-b" });
  });

  it("调用方已配置该头时按大小写不敏感保留，且不修改入参", () => {
    const headers = { "X-OpenCode-Session": "configured", "X-Custom": "keep" };
    expect(resolveOpencodeSessionHeaders(MODEL, { sessionId: "conversation", headers })).toBe(
      headers,
    );
    expect(headers).toEqual({ "X-OpenCode-Session": "configured", "X-Custom": "keep" });
  });

  it("模型级已配置该头时同样保留", () => {
    const model = {
      baseUrl: "https://opencode.ai/zen/v1",
      headers: { "X-OpenCode-Session": "model-session" },
    };
    const headers = { "X-Custom": "keep" };
    expect(resolveOpencodeSessionHeaders(model, { sessionId: "conversation", headers })).toBe(headers);
    expect(resolveOpencodeSessionHeaders(model, { sessionId: "conversation" })).toBeUndefined();
  });

  it("没有会话标识时不臆造共享会话", () => {
    expect(resolveOpencodeSessionHeaders(MODEL)).toBeUndefined();
    expect(resolveOpencodeSessionHeaders(MODEL, { headers: { "X-Custom": "keep" } })).toEqual({
      "X-Custom": "keep",
    });
  });
});
