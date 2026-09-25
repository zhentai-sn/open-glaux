// 连接预填默认值（SDD 00 §4）：缺省 200K / 32K；旧默认组合 128000/8192 载入时迁移，手改值不动。
// store 为模块级单例（loadConnection 在 import 时执行），故用 resetModules + 动态 import 取新实例。
import { beforeEach, describe, expect, it, vi } from "vitest";

async function freshConnection() {
  vi.resetModules();
  const mod = await import("./session");
  return mod.useSession.getState().connection;
}

describe("连接预填默认值", () => {
  beforeEach(() => localStorage.clear());

  it("无持久化 → 200000 / 32768", async () => {
    const c = await freshConnection();
    expect(c.contextWindow).toBe(200_000);
    expect(c.maxTokens).toBe(32_768);
  });

  it("旧默认组合 128000 / 8192 → 迁移为新默认", async () => {
    localStorage.setItem("glaux.connection", JSON.stringify({ provider: "openai_compatible", contextWindow: 128_000, maxTokens: 8_192 }));
    const c = await freshConnection();
    expect(c.contextWindow).toBe(200_000);
    expect(c.maxTokens).toBe(32_768);
    expect(c.provider).toBe("openai_compatible");
  });

  it("只有一项等于旧默认（视为手改或上游值）→ 保留", async () => {
    localStorage.setItem("glaux.connection", JSON.stringify({ contextWindow: 128_000, maxTokens: 4_096 }));
    const c = await freshConnection();
    expect(c.contextWindow).toBe(128_000);
    expect(c.maxTokens).toBe(4_096);
  });
});
