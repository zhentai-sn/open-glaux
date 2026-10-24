import { beforeEach, describe, expect, it, vi } from "vitest";

// 阅读偏好：默认、持久化、非法值回落，以及 <html data-reading> 的落点。
// 模块加载即应用属性，所以每个用例重置模块后再取 store。
beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.reading;
  vi.resetModules();
});

async function load() {
  return import("./reading");
}

describe("reading store", () => {
  it("缺省为标准档、跟随与渐现打开", async () => {
    const { useReading } = await load();
    const state = useReading.getState();
    expect(state.size).toBe("standard");
    expect(state.follow).toBe(true);
    expect(state.reveal).toBe(true);
    expect(document.documentElement.dataset.reading).toBe("standard");
  });

  it("读取已保存的档位与开关并落到 <html>", async () => {
    localStorage.setItem(
      "glaux.reading.v1",
      JSON.stringify({ size: "comfortable", follow: false, reveal: false }),
    );
    const { useReading } = await load();
    expect(useReading.getState().size).toBe("comfortable");
    expect(useReading.getState().follow).toBe(false);
    expect(useReading.getState().reveal).toBe(false);
    expect(document.documentElement.dataset.reading).toBe("comfortable");
  });

  it("存储损坏时回落默认值", async () => {
    localStorage.setItem("glaux.reading.v1", "{not json");
    const { useReading } = await load();
    expect(useReading.getState().size).toBe("standard");
    expect(useReading.getState().follow).toBe(true);
  });

  it("非法档位只回落该字段，其余保留", async () => {
    localStorage.setItem(
      "glaux.reading.v1",
      JSON.stringify({ size: "huge", follow: false, reveal: true }),
    );
    const { useReading } = await load();
    expect(useReading.getState().size).toBe("standard");
    expect(useReading.getState().follow).toBe(false);
  });

  it("setSize 同时更新属性与持久化", async () => {
    const { useReading, READING_KEY } = await load();
    useReading.getState().setSize("compact");
    expect(document.documentElement.dataset.reading).toBe("compact");
    expect(JSON.parse(localStorage.getItem(READING_KEY) ?? "{}").size).toBe("compact");
  });

  it("非法档位忽略，不写存储", async () => {
    const { useReading, READING_KEY } = await load();
    useReading.getState().setSize("huge" as never);
    expect(useReading.getState().size).toBe("standard");
    expect(localStorage.getItem(READING_KEY)).toBeNull();
  });

  it("setFollow 持久化开关", async () => {
    const { useReading, READING_KEY } = await load();
    useReading.getState().setFollow(false);
    expect(JSON.parse(localStorage.getItem(READING_KEY) ?? "{}").follow).toBe(false);
  });
});
