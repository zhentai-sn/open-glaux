// 提示队列契约（信任可见 G5）：并发 notify 入队不互相顶掉；dismiss 精确移除；上限 6 丢最旧。
import { beforeEach, describe, expect, it, vi } from "vitest";

async function freshStore() {
  vi.resetModules();
  const mod = await import("./session");
  return mod.useSession;
}

describe("notice 队列", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("连续 notify 入队保序，不互相覆盖", async () => {
    const useSession = await freshStore();
    useSession.getState().notify("info", "第一条");
    useSession.getState().notify("crit", "第二条");
    const { notices } = useSession.getState();
    expect(notices).toHaveLength(2);
    expect(notices[0].text).toBe("第一条");
    expect(notices[1].text).toBe("第二条");
  });

  it("dismiss 队首后第二条上位（逐条呈现）", async () => {
    const useSession = await freshStore();
    useSession.getState().notify("info", "第一条");
    useSession.getState().notify("crit", "第二条");
    const headId = useSession.getState().notices[0].id;
    useSession.getState().dismissNotice(headId);
    const { notices } = useSession.getState();
    expect(notices).toHaveLength(1);
    expect(notices[0].text).toBe("第二条");
  });

  it("dismiss 指定 id 只移除那条，不误伤队列其他项", async () => {
    const useSession = await freshStore();
    useSession.getState().notify("info", "A");
    useSession.getState().notify("info", "B");
    const secondId = useSession.getState().notices[1].id;
    useSession.getState().dismissNotice(secondId);
    const { notices } = useSession.getState();
    expect(notices).toHaveLength(1);
    expect(notices[0].text).toBe("A");
  });

  it("上限 6 条：超出丢最旧，保留最近关键失败", async () => {
    const useSession = await freshStore();
    for (let i = 1; i <= 8; i++) useSession.getState().notify("crit", `失败${i}`);
    const { notices } = useSession.getState();
    expect(notices).toHaveLength(6);
    expect(notices[0].text).toBe("失败3"); // 1、2 被挤出
    expect(notices[5].text).toBe("失败8");
  });
});
