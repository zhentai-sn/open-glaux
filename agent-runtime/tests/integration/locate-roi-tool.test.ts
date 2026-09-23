/**
 * `locate_roi` 工具（SDD 02 §6 / §7.2）——视觉模型 grounding，可带图谱先验。
 *
 * 覆盖：归一化坐标换算回像素、越界裁剪与退化框丢弃、0 命中如实告知、
 * 图谱先验接入与不可用时的退化、尺寸解析失败即报错（不猜默认值）、视觉门控。
 */

import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  type Context,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import type { AtlasExemplar } from "../../src/atlas/client.js";
import { defaultToolFactory } from "../../src/pi/harness-registry.js";
import type { ModelRuntime } from "../../src/pi/model-runtime.js";
import {
  createLocateRoiTool,
  LOCATE_ROI_TOOL_NAME,
  readImageSize,
  type RoiLocatedDetails,
} from "../../src/pi/tools/locate-roi.js";
import type { VisionRuntime } from "../../src/pi/vision.js";
import type { ConnectionInput } from "../../src/contracts.js";
import { observedObjectId, viewerOn } from "../helpers/viewer-fixture.js";

const WIDTH = 800;
const HEIGHT = 600;

/** 造一张最小合法 PNG 头（IHDR 里写死宽高）——尺寸解析走的就是这几个字节。 */
function pngBytes(width = WIDTH, height = HEIGHT): Uint8Array {
  const buf = Buffer.alloc(24);
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12);
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return new Uint8Array(buf);
}

function ex(id: string): AtlasExemplar {
  return {
    exemplar_id: id,
    image_ref: `images/${id}.png`,
    crop_ref: null,
    roi: [0, 0, 10, 10],
    geometry: null,
    tags: ["edd"],
    tags_raw: ["EDD"],
    caption: `caption ${id}`,
    notes: null,
    description: { summary: `summary ${id}` },
    describe_status: "done",
    source_type: "textbook",
    source: {},
    egress: "shareable",
    status: "active",
    created_at: "2026-08-16T00:00:00Z",
    score: 1,
    matched_tags: ["edd"],
  };
}

function fakeBackend(opts: { exemplars?: AtlasExemplar[]; image?: Uint8Array | null } = {}) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    const u = new URL(url);
    if (u.pathname === "/atlas/exemplars/search") {
      return new Response(JSON.stringify(opts.exemplars ?? []), {
        headers: { "content-type": "application/json" },
      });
    }
    if (u.pathname.endsWith("/crop")) return new Response(Buffer.from("crop"));
    if (u.pathname === "/atlas/exemplars/referenced") return new Response("{}");
    if (observedObjectId(url) !== undefined) {
      if (opts.image === null) return new Response("nf", { status: 404 });
      return new Response(Buffer.from(opts.image ?? pngBytes()), {
        headers: { "content-type": "image/png" },
      });
    }
    return new Response("nf", { status: 404 });
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, calls };
}

function visionRuntime(answers: string[]): { rt: ModelRuntime; contexts: Context[] } {
  const contexts: Context[] = [];
  const faux = fauxProvider({ models: [{ id: "vlm", input: ["text", "image"] }] });
  faux.setResponses(
    answers.map((a) => (ctx: Context) => {
      contexts.push(ctx);
      return fauxAssistantMessage(a);
    }),
  );
  const models = createModels();
  models.setProvider(faux.provider);
  return { rt: { models, model: faux.getModel(), disposeCredential() {} }, contexts };
}

const HOSTED = { provider: "openai-compatible", base_url: "https://api.example.com/v1" };

// imageId 用 null 表示"没开图"——传 undefined 会触发默认参数，反而拿到 img_1
function toolFor(fetchImpl: typeof fetch, rt: VisionRuntime, imageId: string | null = "img_1") {
  return createLocateRoiTool({
    runtime: rt,
    connection: HOSTED,
    fetch: fetchImpl,
    viewer: imageId ? viewerOn(imageId) : {},
  });
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
}

describe("readImageSize", () => {
  it("读 PNG 头的宽高", () => {
    expect(readImageSize(pngBytes(1024, 829))).toEqual({ width: 1024, height: 829 });
  });

  it("读 JPEG 的 SOF0 宽高", () => {
    const buf = Buffer.from([
      0xff, 0xd8, // SOI
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x02, 0x58, // SOF0: h=300, w=600
      0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    ]);
    expect(readImageSize(new Uint8Array(buf))).toEqual({ width: 600, height: 300 });
  });

  it("认不出的格式返回 null（调用方据此报错而非猜默认值）", () => {
    expect(readImageSize(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });
});

describe("locate_roi", () => {
  it("归一化坐标乘回图像像素", async () => {
    const backend = fakeBackend();
    const { rt } = visionRuntime([
      JSON.stringify({ boxes: [{ box: [0.25, 0.5, 0.5, 0.75], confidence: 0.9, why: "低回声区" }] }),
    ]);
    const result = await toolFor(backend.fetch, rt).execute(
      "c1",
      { target: "斑块", use_atlas: false },
      undefined,
      undefined,
      undefined,
    );
    const details = result.details as RoiLocatedDetails;
    expect(details.payload.boxes).toHaveLength(1);
    // 0.25*800=200, 0.5*600=300, 0.5*800=400, 0.75*600=450
    expect(details.payload.boxes[0]!.box).toEqual([200, 300, 400, 450]);
    expect(details.payload.boxes[0]!.confidence).toBeCloseTo(0.9);
    expect(details.payload.boxes[0]!.why).toBe("低回声区");
  });

  it("越界坐标裁回图内，坐标颠倒时归一化", async () => {
    const backend = fakeBackend();
    const { rt } = visionRuntime([
      JSON.stringify({ boxes: [{ box: [0.9, 0.9, 0.1, 0.1], confidence: 0.5 }] }),
    ]);
    const result = await toolFor(backend.fetch, rt).execute(
      "c2",
      { target: "x", use_atlas: false },
      undefined,
      undefined,
      undefined,
    );
    const box = (result.details as RoiLocatedDetails).payload.boxes[0]!.box;
    expect(box[0]).toBeLessThan(box[2]);
    expect(box[1]).toBeLessThan(box[3]);
    expect(box[2]).toBeLessThanOrEqual(WIDTH);
    expect(box[3]).toBeLessThanOrEqual(HEIGHT);
  });

  it("退化框（零宽）丢弃，不交给下游", async () => {
    const backend = fakeBackend();
    const { rt } = visionRuntime([
      JSON.stringify({
        boxes: [
          { box: [0.5, 0.2, 0.5, 0.8], confidence: 0.9 },
          { box: [0.1, 0.1, 0.4, 0.4], confidence: 0.8 },
        ],
      }),
    ]);
    const result = await toolFor(backend.fetch, rt).execute(
      "c3",
      { target: "x", use_atlas: false },
      undefined,
      undefined,
      undefined,
    );
    expect((result.details as RoiLocatedDetails).payload.boxes).toHaveLength(1);
  });

  it("模型直接给像素坐标时按像素理解，不当成归一化", async () => {
    const backend = fakeBackend();
    const { rt } = visionRuntime([
      JSON.stringify({ boxes: [{ box: [100, 120, 300, 340], confidence: 0.7 }] }),
    ]);
    const result = await toolFor(backend.fetch, rt).execute(
      "c4",
      { target: "x", use_atlas: false },
      undefined,
      undefined,
      undefined,
    );
    expect((result.details as RoiLocatedDetails).payload.boxes[0]!.box).toEqual([100, 120, 300, 340]);
  });

  it("0 命中时明确要求不要编位置", async () => {
    const backend = fakeBackend();
    const { rt } = visionRuntime([JSON.stringify({ boxes: [] })]);
    const result = await toolFor(backend.fetch, rt).execute(
      "c5",
      { target: "斑块", use_atlas: false },
      undefined,
      undefined,
      undefined,
    );
    expect(textOf(result)).toMatch(/Do not invent a location/u);
    expect((result.details as RoiLocatedDetails).payload.boxes).toHaveLength(0);
  });

  it("低置信度被滤掉并如实计数", async () => {
    const backend = fakeBackend();
    const { rt } = visionRuntime([
      JSON.stringify({
        boxes: [
          { box: [0.1, 0.1, 0.4, 0.4], confidence: 0.9 },
          { box: [0.5, 0.5, 0.7, 0.7], confidence: 0.05 },
        ],
      }),
    ]);
    const result = await toolFor(backend.fetch, rt).execute(
      "c6",
      { target: "x", use_atlas: false, min_confidence: 0.5 },
      undefined,
      undefined,
      undefined,
    );
    const p = (result.details as RoiLocatedDetails).payload;
    expect(p.boxes).toHaveLength(1);
    expect(p.filtered_out).toBe(1);
  });

  it("默认开图谱先验：先挑案例，再带着案例定位", async () => {
    const backend = fakeBackend({ exemplars: [ex("e1"), ex("e2"), ex("e3"), ex("e4")] });
    const { rt, contexts } = visionRuntime([
      JSON.stringify({ selected: ["e1", "e2"] }), // 挑选步
      JSON.stringify({ boxes: [{ box: [0.2, 0.2, 0.5, 0.5], confidence: 0.8 }] }), // 定位步
    ]);
    const result = await toolFor(backend.fetch, rt).execute(
      "c7",
      { target: "EDD" },
      undefined,
      undefined,
      undefined,
    );

    expect(contexts).toHaveLength(2); // 两步都调了模型
    const details = result.details as RoiLocatedDetails;
    expect(details.payload.atlas?.selected_ids).toEqual(["e1", "e2"]);
    expect(textOf(result)).toMatch(/2 atlas reference case/u);
    expect(backend.calls.some((u) => u.includes("/atlas/exemplars/referenced"))).toBe(true);
  });

  it("图谱不可用时退化为无先验定位，不让整次调用失败", async () => {
    const backend = {
      fetch: (async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (observedObjectId(url) !== undefined) {
          return new Response(Buffer.from(pngBytes()), { headers: { "content-type": "image/png" } });
        }
        return new Response("boom", { status: 500 }); // 图谱全挂
      }) as unknown as typeof fetch,
    };
    const { rt } = visionRuntime([
      JSON.stringify({ boxes: [{ box: [0.2, 0.2, 0.5, 0.5], confidence: 0.8 }] }),
    ]);
    const result = await toolFor(backend.fetch, rt).execute(
      "c8",
      { target: "EDD" },
      undefined,
      undefined,
      undefined,
    );
    expect((result.details as RoiLocatedDetails).payload.boxes).toHaveLength(1);
    expect((result.details as RoiLocatedDetails).payload.atlas).toBeUndefined();
  });

  it("没开图时不调模型", async () => {
    const backend = fakeBackend();
    const { rt, contexts } = visionRuntime([]);
    const result = await toolFor(backend.fetch, rt, null).execute(
      "c9",
      { target: "x" },
      undefined,
      undefined,
      undefined,
    );
    expect(textOf(result)).toMatch(/No image is open/u);
    expect(contexts).toHaveLength(0);
  });

  it("尺寸解析不出时报错——不猜默认尺寸", async () => {
    const backend = fakeBackend({ image: new Uint8Array([1, 2, 3, 4]) });
    const { rt } = visionRuntime([]);
    await expect(
      toolFor(backend.fetch, rt).execute(
        "c10",
        { target: "x", use_atlas: false },
        undefined,
        undefined,
        undefined,
      ),
    ).rejects.toThrow(/尺寸/u);
  });
});

describe("locate_roi 门控", () => {
  const runtime = visionRuntime([]).rt;

  it("视觉连接才挂（同 consult_atlas）", () => {
    const withVision = defaultToolFactory({
      permissionMode: "controlled",
      connection: { ...HOSTED, vision: true } as ConnectionInput,
      runtime,
    });
    expect(withVision.map((t) => t.name)).toContain(LOCATE_ROI_TOOL_NAME);

    const withoutVision = defaultToolFactory({
      permissionMode: "controlled",
      connection: { ...HOSTED, vision: false } as ConnectionInput,
      runtime,
    });
    expect(withoutVision.map((t) => t.name)).not.toContain(LOCATE_ROI_TOOL_NAME);
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
