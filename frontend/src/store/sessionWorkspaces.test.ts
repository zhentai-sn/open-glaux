// SDD 13 §7.7 / §9.6：会话工作区换入换出、后台结果落点与持久化。
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Focus } from "../api/types";
import { objectMeta } from "../test/fixtures";

const STORAGE_KEY = "glaux.sessionWorkspace.v1";

function focusOf(id: string): Focus {
  return { object_id: id, kind: "image", index: {}, region: null };
}

async function fresh() {
  vi.resetModules();
  const { useSession } = await import("./session");
  const ws = await import("./sessionWorkspaces");
  useSession.setState({
    modality: "natural_image",
    objects: {
      natural_image: [
        objectMeta({ id: "x", modality: "natural_image" }),
        objectMeta({ id: "y", modality: "natural_image" }),
      ],
    },
  });
  return { useSession, ws };
}

beforeEach(() => localStorage.clear());

describe("session workspaces", () => {
  it("换出再换入恢复焦点、结果与草稿", async () => {
    const { useSession, ws } = await fresh();
    await ws.restoreWorkspace("a");
    useSession.setState({
      focus: focusOf("x"),
      metrics: { imt: { value: 0.7, unit: "mm" } } as never,
      composerDraft: "半句话",
    });
    ws.saveWorkspace("a");

    await ws.restoreWorkspace("b");
    expect(useSession.getState().focus).toBeNull();
    expect(useSession.getState().metrics).toBeNull();
    expect(useSession.getState().composerDraft).toBe("");
    expect(useSession.getState().modality).toBe("natural_image"); // 空工作区保留当前模态

    ws.saveWorkspace("b");
    await ws.restoreWorkspace("a");
    expect(useSession.getState().focus?.object_id).toBe("x");
    expect(useSession.getState().metrics).toEqual({ imt: { value: 0.7, unit: "mm" } });
    expect(useSession.getState().composerDraft).toBe("半句话");
  });

  it("焦点对象变化时清空标注，由查看器重新拉取", async () => {
    const { useSession, ws } = await fresh();
    await ws.restoreWorkspace("a");
    useSession.setState({ focus: focusOf("x") });
    ws.saveWorkspace("a");
    await ws.restoreWorkspace("b");
    useSession.setState({ focus: focusOf("y"), annotations: [{ id: "ann" }] as never });
    ws.saveWorkspace("b");

    await ws.restoreWorkspace("a");
    expect(useSession.getState().annotations).toEqual([]);
  });

  it("后台结果只在快照焦点仍是该对象时写入", async () => {
    const { ws } = await fresh();
    await ws.restoreWorkspace("a");
    const { useSession } = await import("./session");
    useSession.setState({ focus: focusOf("x") });
    ws.saveWorkspace("a");

    const output = { metrics: { d: { value: 1, unit: "mm" } } as never, primitives: [], modelVersion: "m1" };
    expect(ws.writeBackgroundTaskOutput("a", "y", output)).toBe(false);
    expect(ws.workspaceOf("a")?.metrics).toBeNull();
    expect(ws.writeBackgroundTaskOutput("a", "x", output)).toBe(true);
    expect(ws.workspaceOf("a")).toMatchObject({ metrics: output.metrics, modelVersion: "m1", source: "agent" });
  });

  it("前台焦点即时持久化，刷新后按会话恢复", async () => {
    const first = await fresh();
    await first.ws.restoreWorkspace("a");
    first.useSession.getState().setFocus(focusOf("y"));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).a.focus.object_id).toBe("y");

    const second = await fresh(); // 模拟刷新：内存快照清空，只剩持久化
    await second.ws.restoreWorkspace("a");
    expect(second.useSession.getState().focus?.object_id).toBe("y");
  });

  it("持久化的焦点对象已不存在时清空焦点", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ a: { modality: "natural_image", focus: focusOf("gone") } }),
    );
    const { useSession, ws } = await fresh();
    await ws.restoreWorkspace("a");
    expect(useSession.getState().focus).toBeNull();
  });

  it("非法持久化值回退空工作区", async () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    const { useSession, ws } = await fresh();
    await ws.restoreWorkspace("a");
    expect(useSession.getState().focus).toBeNull();

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ a: { modality: 3, focus: { object_id: 1 } } }));
    await ws.restoreWorkspace("a");
    expect(useSession.getState().focus).toBeNull();
  });

  it("删除会话时清掉快照与持久化条目", async () => {
    const { useSession, ws } = await fresh();
    await ws.restoreWorkspace("a");
    useSession.getState().setFocus(focusOf("x"));
    ws.saveWorkspace("a");
    ws.dropWorkspace("a");
    expect(ws.workspaceOf("a")).toBeUndefined();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).a).toBeUndefined();
  });
});
