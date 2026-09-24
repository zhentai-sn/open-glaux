import { describe, expect, it, vi } from "vitest";

import type { Focus, ReferenceFrame } from "../../src/contracts.js";
import { fetchObservation, toObjectCoords, toObjectPoint } from "../../src/observation/index.js";
import { FIXTURE_OBJECT_IDS, objectFrameStub } from "../helpers/viewer-fixture.js";

const base = "http://backend.test";
const focus = (id: string, kind: Focus["kind"], index: Focus["index"], region: Focus["region"] = null): Focus =>
  ({ object_id: id, kind, index, region });

describe("fetchObservation", () => {
  it.each([
    ["image", focus(FIXTURE_OBJECT_IDS.image, "image", {}), ""],
    ["CT", focus(FIXTURE_OBJECT_IDS.ct, "volume", { z: 42 }), "z=42"],
    ["WSI", focus(FIXTURE_OBJECT_IDS.slide, "slide", { level: 0 }, { kind: "box", x0: 1000, y0: 2000, x1: 1512, y1: 2512 }), "level=0&roi=1000%2C2000%2C1512%2C2512"],
    ["video", focus(FIXTURE_OBJECT_IDS.video, "video", { t: 10 }), "t=10"],
  ] as const)("%s 取帧携带焦点索引与 ReferenceFrame", async (_label, current, query) => {
    const doFetch = vi.fn(async (input: Parameters<typeof fetch>[0]) => objectFrameStub(String(input))!);
    const observation = await fetchObservation(base, current, { fetch: doFetch });
    expect(observation.bytes.length).toBeGreaterThan(24);
    expect(observation.mime).toBe("image/png");
    expect(observation.frame.object_id).toBe(current.object_id);
    expect(observation.frame.index).toEqual(current.index);
    expect(observation.frame.origin).toEqual(current.region?.kind === "box" ? [current.region.x0, current.region.y0] : [0, 0]);
    expect(String(doFetch.mock.calls[0]![0])).toBe(`${base}/objects/${current.object_id}/frame${query ? `?${query}` : ""}`);
  });

  it("缺坐标头或对象不一致时拒绝把字节交给模型", async () => {
    const current = focus(FIXTURE_OBJECT_IDS.ct, "volume", { z: 1 });
    await expect(fetchObservation(base, current, { fetch: async () => new Response("bytes", { headers: { "content-type": "image/png" } }) }))
      .rejects.toMatchObject({ code: "image_unavailable" });
    const frame = { object_id: "other", index: { z: 1 }, origin: [0, 0], scale: 1, width: 64, height: 48 };
    await expect(fetchObservation(base, current, { fetch: async () => new Response("bytes", { headers: { "content-type": "image/png", "x-glaux-frame": JSON.stringify(frame) } }) }))
      .rejects.toMatchObject({ code: "image_unavailable" });
  });

  it("WSI 浮点标注选区向外取整后请求帧，并以服务端 origin 定位", async () => {
    const current = focus(FIXTURE_OBJECT_IDS.slide, "slide", { level: 0 }, { kind: "box", x0: 1000.2, y0: 2000.6, x1: 1511.4, y1: 2511.1 });
    const doFetch = vi.fn(async (input: Parameters<typeof fetch>[0]) => objectFrameStub(String(input))!);
    const observation = await fetchObservation(base, current, { fetch: doFetch });
    expect(String(doFetch.mock.calls[0]![0])).toContain("roi=1000%2C2000%2C1512%2C2512");
    expect(observation.frame.origin).toEqual([1000, 2000]);
  });
});

describe("toObjectCoords", () => {
  it("帧像素经 origin/scale 往返对象像素，整数域无误差", () => {
    const frame: ReferenceFrame = { object_id: "slide_001", index: { level: 2 }, origin: [1000, 2000], scale: 0.5, width: 256, height: 256 };
    const box = toObjectCoords([10, 20, 110, 120], frame);
    expect(box).toEqual({ kind: "box", x0: 1020, y0: 2040, x1: 1220, y1: 2240 });
    expect([box.x0, box.y0, box.x1, box.y1].map((n, i) => (n - frame.origin[i % 2]!) * frame.scale)).toEqual([10, 20, 110, 120]);
    expect(toObjectPoint([10, 20], frame)).toEqual([1020, 2040]);
  });
});
