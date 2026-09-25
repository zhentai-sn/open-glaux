/**
 * `view_current_image` 工具——把查看器当前图的像素交给模型。
 *
 * 覆盖：正常取图返回 image 块、没开图时只回文字不回图、后端 404 报错、
 * 超大图拒发但如实说明、坐标头缺失拒发、目录标签措辞、视觉门控与 observe 模式。
 */

import { describe, expect, it } from "vitest";

import { defaultToolFactory } from "../../src/pi/harness-registry.js";
import type { ModelRuntime } from "../../src/pi/model-runtime.js";
import {
  createViewCurrentImageTool,
  VIEW_CURRENT_IMAGE_TOOL_NAME,
  type ImageViewedDetails,
} from "../../src/pi/tools/view-image.js";
import type { ConnectionInput } from "../../src/contracts.js";
import { observedObjectId, targetObjectId, viewerOn } from "../helpers/viewer-fixture.js";

const WIDTH = 1024;
const HEIGHT = 973;

/** 最小合法 PNG 头（IHDR 写死宽高）——尺寸解析只看这几个字节。 */
function pngBytes(width = WIDTH, height = HEIGHT, pad = 0): Uint8Array {
  const buf = Buffer.alloc(24 + pad);
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12);
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return new Uint8Array(buf);
}

function fakeBackend(opts: { image?: Uint8Array | null; contentType?: string; frameHeader?: boolean; frameTime?: string } = {}) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    if (observedObjectId(url) === undefined) return new Response("nf", { status: 404 });
    if (opts.image === null) return new Response("nf", { status: 404 });
    const id = observedObjectId(url)!;
    const u = new URL(url);
    const index: Record<string, number> = {};
    for (const axis of ["z", "t", "level"]) {
      const value = u.searchParams.get(axis);
      if (value !== null) index[axis] = Number(value);
    }
    const header = { object_id: id, index, origin: [0, 0], scale: 1, width: WIDTH, height: HEIGHT };
    return new Response(Buffer.from(opts.image ?? pngBytes()), {
      headers: {
        "content-type": opts.contentType ?? "image/png",
        ...(opts.frameHeader === false ? {} : { "x-glaux-frame": JSON.stringify(header) }),
        ...(opts.frameTime !== undefined ? { "x-glaux-frame-time": opts.frameTime } : {}),
      },
    });
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, calls };
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
}

function imagesOf(result: { content: Array<{ type: string; data?: string; mimeType?: string }> }) {
  return result.content.filter((c) => c.type === "image");
}

const HOSTED = { provider: "openai-compatible", base_url: "https://api.example.com/v1" };

describe("view_current_image", () => {
  it("把当前图的像素交给模型，并报出 id 与尺寸", async () => {
    const backend = fakeBackend();
    const tool = createViewCurrentImageTool({
      fetch: backend.fetch,
      viewer: viewerOn("tech_0450", { collection: "carotid_imt", task: "far_wall_cca_imt" }),
    });

    const result = await tool.execute("call_1", {}, undefined, undefined, undefined);
    const images = imagesOf(result);

    expect(images).toHaveLength(1);
    expect(images[0]?.mimeType).toBe("image/png");
    expect(images[0]?.data).toBe(Buffer.from(pngBytes()).toString("base64"));
    expect(textOf(result)).toContain("tech_0450");
    expect(textOf(result)).toContain(`${WIDTH}×${HEIGHT}`);
    // 取的是查看器当前对象的观测图，且只取一次
    expect(backend.calls.map(observedObjectId)).toEqual(["tech_0450"]);

    const details = result.details as ImageViewedDetails;
    expect(targetObjectId(details.payload)).toBe("tech_0450");
    expect(details.payload).toMatchObject({
      width: WIDTH,
      height: HEIGHT,
      mime_type: "image/png",
    });
  });

  it("把 viewer 里的模态/任务讲成目录标签，并要求以画面为准", async () => {
    const tool = createViewCurrentImageTool({
      fetch: fakeBackend().fetch,
      viewer: viewerOn("tech_0450", { collection: "carotid_imt" }),
    });
    const text = textOf(await tool.execute("call_1", {}, undefined, undefined, undefined));
    // 数据集标签被复述给模型，但措辞是目录标签而非观察（字段名随 W5 可能改为 collection）
    expect(text).toContain("carotid_imt");
    expect(text).toContain("catalogue label");
    expect(text).toMatch(/not an observation/u);
  });

  it("视频在 t=10 时取同一帧，并把帧号告诉模型", async () => {
    const backend = fakeBackend();
    const tool = createViewCurrentImageTool({
      fetch: backend.fetch,
      viewer: viewerOn("vid-0001", { kind: "video", index: { t: 10 } }),
    });
    const result = await tool.execute("video-10", {}, undefined, undefined, undefined);
    expect(imagesOf(result)).toHaveLength(1);
    expect(backend.calls[0]).toContain("/objects/vid-0001/frame?t=10");
    expect(textOf(result)).toContain("at t=10");
    expect(textOf(result)).not.toContain("source time");
  });

  it("后端给出帧的源时间时一并告诉模型；时间头非法则拒发", async () => {
    const viewer = viewerOn("vid-0001", { kind: "video", index: { t: 49 } });
    const ok = createViewCurrentImageTool({ fetch: fakeBackend({ frameTime: "1633" }).fetch, viewer });
    const result = await ok.execute("video-49", {}, undefined, undefined, undefined);
    expect(textOf(result)).toContain("at t=49, source time 1633 ms");

    const bad = createViewCurrentImageTool({ fetch: fakeBackend({ frameTime: "-1" }).fetch, viewer });
    await expect(bad.execute("video-bad", {}, undefined, undefined, undefined)).rejects.toThrow(/X-Glaux-Frame-Time/u);
  });

  it("没开图：只回文字，不回图，也不打后端", async () => {
    const backend = fakeBackend();
    const tool = createViewCurrentImageTool({ fetch: backend.fetch, viewer: {} });
    const result = await tool.execute("call_1", {}, undefined, undefined, undefined);

    expect(imagesOf(result)).toHaveLength(0);
    expect(textOf(result)).toMatch(/No image is open/u);
    expect(backend.calls).toEqual([]);
    expect(targetObjectId((result.details as ImageViewedDetails).payload)).toBe("");
  });

  it("后端取不到图就报错，不静默返回空", async () => {
    const tool = createViewCurrentImageTool({
      fetch: fakeBackend({ image: null }).fetch,
      viewer: viewerOn("missing"),
    });
    await expect(tool.execute("call_1", {}, undefined, undefined, undefined)).rejects.toThrow(
      /HTTP 404/u,
    );
  });

  it("超过上限的图不往模型送，但如实说明并指向 locate_roi", async () => {
    const tool = createViewCurrentImageTool({
      fetch: fakeBackend({ image: pngBytes(WIDTH, HEIGHT, 4096) }).fetch,
      viewer: viewerOn("huge"),
      maxBytes: 1024,
    });
    const result = await tool.execute("call_1", {}, undefined, undefined, undefined);

    expect(imagesOf(result)).toHaveLength(0);
    expect(textOf(result)).toContain("locate_roi");
    expect((result.details as ImageViewedDetails).payload.bytes).toBe(0);
  });

  it("坐标头缺失时拒发，防止模型拿到无法定位的图", async () => {
    const tool = createViewCurrentImageTool({
      fetch: fakeBackend({ image: new Uint8Array([1, 2, 3, 4]), frameHeader: false }).fetch,
      viewer: viewerOn("odd"),
    });
    await expect(tool.execute("call_1", {}, undefined, undefined, undefined)).rejects.toMatchObject({ code: "image_unavailable" });
  });
});

describe("view_current_image 门控", () => {
  const runtime = undefined as unknown as ModelRuntime;

  it("只在连接声明 vision 时挂上", () => {
    expect(
      defaultToolFactory({
        permissionMode: "controlled",
        viewer: viewerOn("tech_0450"),
        connection: { ...HOSTED, vision: true } as ConnectionInput,
        runtime,
      }).map((t) => t.name),
    ).toContain(VIEW_CURRENT_IMAGE_TOOL_NAME);

    expect(
      defaultToolFactory({
        permissionMode: "controlled",
        viewer: viewerOn("tech_0450"),
        connection: { ...HOSTED, vision: false } as ConnectionInput,
        runtime,
      }).map((t) => t.name),
    ).not.toContain(VIEW_CURRENT_IMAGE_TOOL_NAME);
  });

  it("未选对象时不挂需要 focus 的工具", () => {
    expect(defaultToolFactory({
      permissionMode: "controlled",
      connection: { ...HOSTED, vision: true } as ConnectionInput,
      runtime,
    }).map((t) => t.name)).not.toContain(VIEW_CURRENT_IMAGE_TOOL_NAME);
  });

  it("observe 模式不挂", () => {
    expect(
      defaultToolFactory({
        permissionMode: "observe",
        connection: { ...HOSTED, vision: true } as ConnectionInput,
        runtime,
      }),
    ).toEqual([]);
  });
});
