import { describe, expect, it, vi } from "vitest";

import { objectMeta } from "../test/fixtures";

vi.mock("./cornerstone", () => ({
  csReady: vi.fn(async () => undefined),
  preloadDims: vi.fn(async () => ({ columns: 640, rows: 480 })),
}));
vi.mock("./nifti", () => ({
  niftiReady: vi.fn(async () => undefined),
  preloadNiftiDims: vi.fn(async () => ({ columns: 64, rows: 48, slices: 8 })),
}));

import { preloadDims } from "./cornerstone";
import { frameSourceFor } from "./frameSources";

describe("FrameSource 只消费后端 resources", () => {
  it("image 使用下发 frame 资源", async () => {
    const object = objectMeta({ id: "photo-1", modality: "natural_image", resources: { frame: "/objects/photo-1/frame" } });
    const source = frameSourceFor(object);
    expect(await source.imageIds()).toEqual(["web:/api/objects/photo-1/frame?size=4096"]);
    expect(await source.dims()).toEqual({ columns: 640, rows: 480, frames: 1 });
  });

  it("不超过取帧上限时尺寸取自 axes，不预取帧", async () => {
    vi.mocked(preloadDims).mockClear();
    const object = objectMeta({ id: "photo-2", modality: "natural_image", axes: [{ name: "x", size: 800 }, { name: "y", size: 540 }] });
    expect(await frameSourceFor(object).dims()).toEqual({ columns: 800, rows: 540, frames: 1 });
    expect(preloadDims).not.toHaveBeenCalled();
  });

  it("超过取帧上限时按实际取到的帧定尺寸", async () => {
    vi.mocked(preloadDims).mockClear();
    const object = objectMeta({ id: "photo-3", modality: "natural_image", axes: [{ name: "x", size: 8000 }, { name: "y", size: 6000 }] });
    expect(await frameSourceFor(object).dims()).toEqual({ columns: 640, rows: 480, frames: 1 });
    expect(preloadDims).toHaveBeenCalledOnce();
  });

  it("volume 使用下发 raw 资源生成 z stack", async () => {
    const object = objectMeta({ id: "ct-1", modality: "ct_abdomen", resources: { frame: "/objects/ct-1/frame", raw: "/objects/ct-1/raw" } });
    const source = frameSourceFor(object);
    const ids = await source.imageIds();
    expect(ids).toHaveLength(8);
    expect(ids[3]).toBe("nifti:/api/objects/ct-1/raw#z=3");
    expect(await source.dims()).toEqual({ columns: 64, rows: 48, frames: 8 });
  });

  it("无 raw 资源的 volume 显式拒绝", () => {
    expect(() => frameSourceFor(objectMeta({ id: "ct-1", modality: "ct_abdomen" }))).toThrow("缺少 raw 资源");
  });
});
