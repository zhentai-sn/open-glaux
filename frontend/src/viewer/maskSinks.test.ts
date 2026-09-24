import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TaskView } from "../api/types";
import { taskFields } from "../test/fixtures";
import { annotationMaskSink, editMaskSink } from "./maskSinks";

const h = vi.hoisted(() => ({ createAnnotation: vi.fn() }));
vi.mock("../annotation/bridge", () => ({ createAnnotation: h.createAnnotation }));

const task = {
  task: "totalseg_liver_kidney",
  modality: "ct_abdomen",
  default_method: "model-1",
  ...taskFields("ct_abdomen"),
} as TaskView;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    createImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData: () => undefined,
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,STUB");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("MaskSink 两条写语义", () => {
  it("annotationMaskSink 带对象 id 与索引写标注", async () => {
    h.createAnnotation.mockResolvedValue({ id: "a1" });
    await annotationMaskSink("image-1").commit(new Uint8Array([1]), { columns: 1, rows: 1 }, { t: 3 });
    expect(h.createAnnotation).toHaveBeenCalledWith({
      image_id: "image-1",
      index: { t: 3 },
      primitive: { kind: "mask" },
      mask_png_b64: "data:image/png;base64,STUB",
    });
  });

  it("editMaskSink 调对象编辑端点并沿用服务端 seq", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      return { ok: true, json: async () => ({ metrics: {}, labelmap_ref: "/label", seq: requests.length }) };
    }));
    const onSaved = vi.fn(async () => undefined);
    const sink = editMaskSink({
      objectId: "ct-1", task, method: () => "model-1", brush: () => ({ classId: 2, mode: "paint" }),
      onSaved, notify: vi.fn(),
    });
    await sink.commit(new Uint8Array([1]), { columns: 1, rows: 1 }, { z: 3 });
    await sink.commit(new Uint8Array([1]), { columns: 1, rows: 1 }, { z: 4 });
    expect(requests.map((request) => request.url)).toEqual(["/api/objects/ct-1/edits", "/api/objects/ct-1/edits"]);
    expect(requests.map((request) => request.body.base_seq)).toEqual([0, 1]);
    expect(requests[0].body).toMatchObject({
      task: "totalseg_liver_kidney", method: "model-1",
      ops: [{ index: { z: 3 }, class_id: 2, mode: "paint", mask_png: "data:image/png;base64,STUB" }],
    });
    expect(onSaved).toHaveBeenCalledTimes(2);
  });

  it("409 冲突报告且不更新本地 seq", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ detail: "stale" }) })));
    const notify = vi.fn();
    const sink = editMaskSink({
      objectId: "ct-1", task, method: () => "model-1", brush: () => ({ classId: 2, mode: "paint" }),
      onSaved: vi.fn(), notify,
    });
    await expect(sink.commit(new Uint8Array([1]), { columns: 1, rows: 1 }, { z: 3 })).rejects.toThrow();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("编辑冲突"));
  });
});
