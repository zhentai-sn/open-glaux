/**
 * `viewer` 字段契约（`parseViewer`，SDD 10 §9.1 / §7 规则 6 / D-9 / §13）。
 *
 * 经 HTTP 命令端点下发，断言两件事：合法上下文按原样交到工具工厂；不合契约的上下文 400，
 * 不猜语义。`roi_box` 的四元组语义是角点 `(x0, y0, x1, y1)`，不是 `[x, y, w, h]`。
 * W5 收敛为 `{collection, task, method, object, focus}`；旧字段仅在新字段缺失时映射。
 */

import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ViewerContext } from "../../src/contracts.js";
import type { HarnessToolContext } from "../../src/pi/harness-registry.js";
import { getLegacyViewerHits, resetLegacyViewerHits } from "../../src/transport/routes.js";
import { buildServer } from "../../src/transport/server.js";
import { TEST_CONNECTION, createRuntimeFixture } from "../helpers/runtime-fixture.js";
import {
  FIXTURE_OBJECT_IDS,
  objectFrameStub,
  type ReferenceFrameHeader,
} from "../helpers/viewer-fixture.js";

type Server = ReturnType<typeof buildServer>;

describe("viewer context contract (parseViewer)", () => {
  const cleanups: Array<() => Promise<void>> = [];

  beforeEach(() => { resetLegacyViewerHits(); vi.spyOn(console, "warn").mockImplementation(() => undefined); });

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
    vi.restoreAllMocks();
  });

  /** 起一个 runtime，工具工厂只记录它收到的 viewer（不挂任何工具）。 */
  async function harness() {
    const seen: HarnessToolContext[] = [];
    const fixture = await createRuntimeFixture([[fauxAssistantMessage("ok")]], {
      toolFactory: (context) => {
        seen.push(context);
        return [];
      },
    });
    const server = buildServer({
      routes: {
        sessions: fixture.sessions,
        commands: fixture.commands,
        registry: fixture.registry,
        broker: fixture.broker,
      },
    });
    cleanups.push(async () => {
      await server.close();
      await fixture.close();
    });
    const sessionId = crypto.randomUUID();
    await fixture.sessions.createSession({ session_id: sessionId });
    return { server, fixture, sessionId, seen };
  }

  function prompt(server: Server, sessionId: string, viewer: unknown) {
    return server.inject({
      method: "POST",
      url: `/agent-api/v1/sessions/${sessionId}/commands`,
      payload: {
        command_id: crypto.randomUUID(),
        type: "prompt",
        content: "look",
        connection: TEST_CONNECTION,
        ...(viewer === undefined ? {} : { viewer }),
      },
    });
  }

  /** 发一条带 viewer 的 prompt，返回工具工厂实际收到的 viewer。 */
  async function delivered(viewer: unknown): Promise<ViewerContext | undefined> {
    const { server, fixture, sessionId, seen } = await harness();
    const response = await prompt(server, sessionId, viewer);
    expect(response.statusCode).toBe(202);
    await fixture.registry.waitForIdle(sessionId);
    expect(seen).toHaveLength(1);
    return seen[0]!.viewer;
  }

  async function rejected(viewer: unknown): Promise<{ code: string; message: string }> {
    const { server, sessionId, seen } = await harness();
    const response = await prompt(server, sessionId, viewer);
    expect(response.statusCode).toBe(400);
    expect(seen).toHaveLength(0);
    return response.json().error as { code: string; message: string };
  }

  describe("accepted shapes", () => {
    it("2D 图（颈动脉）：对象 id、数据集、任务、方法与平面标定原样交给工具", async () => {
      const viewer = {
        image_id: FIXTURE_OBJECT_IDS.image,
        modality: "carotid_imt",
        task: "far_wall_cca_imt",
        method: "caroSegDeep",
        cubs_cf: 0.06,
      };
      expect(await delivered(viewer)).toMatchObject({
        collection: "carotid_imt",
        task: viewer.task,
        method: viewer.method,
        object: { id: viewer.image_id, kind: "image", calibration: { kind: "mm_per_px", value: 0.06 } },
        focus: { object_id: viewer.image_id, kind: "image", index: {}, region: null },
      });
      expect(getLegacyViewerHits()).toBe(1);
    });

    it("CT：只有对象 id、数据集与任务，无标定无区域", async () => {
      const viewer = {
        image_id: FIXTURE_OBJECT_IDS.ct,
        modality: "ct_abdomen",
        task: "totalseg_liver_kidney",
      };
      expect(await delivered(viewer)).toMatchObject({
        collection: "ct_abdomen", task: viewer.task,
        object: { id: viewer.image_id, kind: "volume" },
        focus: { object_id: viewer.image_id, kind: "volume", index: { z: 0 }, region: null },
      });
    });

    it("WSI：roi_box 作为角点 (x0, y0, x1, y1) 原样透传，不换算成宽高", async () => {
      const viewer = {
        image_id: FIXTURE_OBJECT_IDS.slide,
        modality: "pathology",
        task: "nuclei_detection",
        roi_box: [1000, 2000, 1512, 2512],
      };
      const got = await delivered(viewer);
      expect(got).toMatchObject({
        collection: "pathology", task: viewer.task,
        object: { id: viewer.image_id, kind: "slide" },
        focus: { object_id: viewer.image_id, kind: "slide", index: { level: 0 }, region: { kind: "box", x0: 1000, y0: 2000, x1: 1512, y1: 2512 } },
      });
      const { x0, y0, x1, y1 } = got!.focus!.region as Extract<NonNullable<ViewerContext["focus"]>["region"], { kind: "box" }>;
      // 角点语义：右下角大于左上角；若按 [x, y, w, h] 解释，这里会是 512 / 512
      expect([x1 - x0, y1 - y0]).toEqual([512, 512]);
    });

    it("roi_box 角点颠倒时不在 runtime 纠正也不拒绝——原样透传，由后端判定", async () => {
      // parseViewer 只校验「四个有限数」（SDD 10 §13）；x0<x1 / y0<y1 由后端硬拒
      // （backend/app/segment_wsi.py 的「ROI 非正」）。W5 若在 runtime 侧加序校验，改此断言。
      const viewer = { image_id: FIXTURE_OBJECT_IDS.slide, roi_box: [1512, 2512, 1000, 2000] };
      expect((await delivered(viewer))?.focus?.region).toEqual({ kind: "box", x0: 1512, y0: 2512, x1: 1000, y1: 2000 });
    });

    it("自然图像：只有对象 id 与数据集，不带任务 / 方法 / 标定", async () => {
      const viewer = { image_id: "coco_000139", modality: "natural_image" };
      expect(await delivered(viewer)).toMatchObject({ collection: "natural_image", object: { id: "coco_000139", kind: "image", calibration: null } });
    });

    it("未开图：只有数据集，不带对象 id", async () => {
      expect(await delivered({ modality: "carotid_imt" })).toEqual({ collection: "carotid_imt" });
    });

    it("空对象是合法上下文（全部字段可选）", async () => {
      expect(await delivered({})).toEqual({});
    });

    it("缺省 / null（chat 发行包不下发 viewer）：工具工厂收不到 viewer", async () => {
      expect(await delivered(undefined)).toBeUndefined();
      expect(await delivered(null)).toBeUndefined();
    });

    it("未知字段丢弃，不透传给工具", async () => {
      expect(await delivered({ image_id: FIXTURE_OBJECT_IDS.video, frame_rate: 25, extra: { a: 1 } })).toMatchObject({
        object: { id: FIXTURE_OBJECT_IDS.video, kind: "video" },
        focus: { object_id: FIXTURE_OBJECT_IDS.video, kind: "video", index: { t: 0 } },
      });
    });

    it("新字段单独可用且优先；旧字段即使非法也整体忽略且不计数", async () => {
      const object = { id: FIXTURE_OBJECT_IDS.ct, kind: "volume", axes: [{ name: "x", size: 512 }, { name: "y", size: 512 }, { name: "z", size: 100 }], calibration: { kind: "voxel_mm", value: [1, 1, 2], source: "nifti" } };
      const focus = { object_id: FIXTURE_OBJECT_IDS.ct, kind: "volume", index: { z: 42 }, region: null };
      expect(await delivered({ collection: "ct_abdomen", object, focus })).toEqual({ collection: "ct_abdomen", object, focus });
      expect(await delivered({ object, focus, image_id: 123, roi_box: "bad" })).toEqual({ object, focus });
      expect(getLegacyViewerHits()).toBe(0);
    });

    it("Focus.kind 不符时以 ObjectMeta.kind 重建并告警", async () => {
      const object = { id: FIXTURE_OBJECT_IDS.ct, kind: "volume", axes: [{ name: "x", size: 512 }, { name: "y", size: 512 }, { name: "z", size: 100 }], calibration: null };
      const focus = { object_id: FIXTURE_OBJECT_IDS.ct, kind: "image", index: { z: 42 }, region: null };
      expect((await delivered({ object, focus }))?.focus?.kind).toBe("volume");
      expect(console.warn).toHaveBeenCalledOnce();
    });

    it("视频帧范围及 seed 原样进入任务上下文", async () => {
      const object = { id: FIXTURE_OBJECT_IDS.video, kind: "video", axes: [{ name: "x", size: 640 }, { name: "y", size: 480 }, { name: "t", size: 100 }], calibration: null };
      const region = { kind: "frame_range", t0: 10, t1: 20, seed: { t: 15, box: [1, 2, 9, 10] } };
      const focus = { object_id: object.id, kind: "video", index: { t: 15 }, region };
      expect((await delivered({ object, focus }))?.focus?.region).toEqual(region);
      expect(getLegacyViewerHits()).toBe(0);
    });

    it("新上下文没有焦点时不挂图像工具；旧字段映射有计数和告警", async () => {
      expect(await delivered({ collection: "pathology" })).toEqual({ collection: "pathology" });
      expect(getLegacyViewerHits()).toBe(0);
      await delivered({ image_id: FIXTURE_OBJECT_IDS.slide, modality: "pathology" });
      expect(getLegacyViewerHits()).toBe(1);
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("累计 1 次"));
    });
  });

  describe("400 branches", () => {
    it.each([
      ["a string", "tech_0450"],
      ["an array", ["tech_0450"]],
      ["a number", 42],
      ["a boolean", true],
    ])("viewer 不是对象（%s）", async (_label, viewer) => {
      expect(await rejected(viewer)).toMatchObject({
        code: "invalid_request",
        message: "A JSON object is required.",
      });
    });

    it.each(["image_id", "task", "modality", "method"])("viewer.%s 不是字符串", async (key) => {
      for (const bad of [1, true, null, ["x"], { id: "x" }]) {
        expect(await rejected({ [key]: bad })).toMatchObject({
          code: "invalid_request",
          message: `viewer.${key} must be a string.`,
        });
      }
    });

    it.each([
      ["a string", "0.06"],
      ["null", null],
      ["an array", [0.06]],
    ])("viewer.cubs_cf 不是数（%s）", async (_label, cf) => {
      expect(await rejected({ image_id: "tech_0450", cubs_cf: cf })).toMatchObject({
        code: "invalid_request",
        message: "viewer.cubs_cf must be a number.",
      });
    });

    it("viewer.cubs_cf 不是有限数（JSON 送不出 NaN / Infinity，序列化后是 null）", async () => {
      // JSON 里写不出 NaN / Infinity，经 HTTP 只会变成 null；此处断言它同样被拒。
      expect(await rejected({ cubs_cf: Number.NaN })).toMatchObject({
        message: "viewer.cubs_cf must be a number.",
      });
    });

    it.each([
      ["not an array", "0,0,10,10"],
      ["an object with corner keys", { x0: 0, y0: 0, x1: 10, y1: 10 }],
      ["three numbers", [0, 0, 10]],
      ["five numbers", [0, 0, 10, 10, 1]],
      ["empty", []],
      ["a string element", [0, 0, "10", 10]],
      ["a null element", [0, 0, null, 10]],
      ["null", null],
    ])("viewer.roi_box 不是四个有限数（%s），报错文案是角点形状", async (_label, box) => {
      expect(await rejected({ image_id: "slide_001", roi_box: box })).toEqual({
        code: "invalid_request",
        message: "viewer.roi_box must be [x0, y0, x1, y1].",
        trace_id: expect.any(String),
      });
    });

    it("新字段的对象与焦点必须同时提供且 id 一致", async () => {
      const object = { id: FIXTURE_OBJECT_IDS.ct, kind: "volume", axes: [{ name: "x", size: 512 }, { name: "y", size: 512 }, { name: "z", size: 100 }], calibration: null };
      expect((await rejected({ object })).message).toContain("viewer.object/focus");
      expect((await rejected({ object, focus: { object_id: "other", kind: "volume", index: { z: 0 }, region: null } })).message).toContain("viewer.focus.object_id");
      expect(getLegacyViewerHits()).toBe(0);
    });

    it("新字段拒绝轴越界与非法 frame_range.seed", async () => {
      const object = { id: FIXTURE_OBJECT_IDS.video, kind: "video", axes: [{ name: "x", size: 640 }, { name: "y", size: 480 }, { name: "t", size: 100 }], calibration: null };
      const focus = { object_id: object.id, kind: "video", index: { t: 100 }, region: null };
      expect((await rejected({ object, focus })).message).toContain("viewer.focus.index.t");
      focus.index.t = 15;
      const invalidFocus = { ...focus, region: { kind: "frame_range", t0: 10, t1: 20, seed: { t: 30, box: [1, 2, 9, 10] } } };
      expect((await rejected({ object, focus: invalidFocus })).message).toContain("viewer.focus.region.seed.t");
    });
  });
});

describe("fake backend frame stub (reserved for W5)", () => {
  it("GET /objects/{id}/frame 回小 PNG 与 X-Glaux-Frame（ReferenceFrame 紧凑 JSON）", async () => {
    for (const [id, query, index, origin] of [
      [FIXTURE_OBJECT_IDS.image, "", {}, [0, 0]],
      [FIXTURE_OBJECT_IDS.ct, "?z=42", { z: 42 }, [0, 0]],
      [FIXTURE_OBJECT_IDS.slide, "?level=0&roi=1000,2000,1512,2512", { level: 0 }, [1000, 2000]],
      [FIXTURE_OBJECT_IDS.video, "?t=10", { t: 10 }, [0, 0]],
    ] as const) {
      const response = objectFrameStub(`http://backend.test/objects/${id}/frame${query}`);
      expect(response?.status).toBe(200);
      expect(response?.headers.get("content-type")).toBe("image/png");
      const header = response!.headers.get("x-glaux-frame")!;
      expect(header).not.toMatch(/\s/u);
      const frame = JSON.parse(header) as ReferenceFrameHeader;
      expect(frame).toEqual({ object_id: id, index, origin, scale: 1, width: 64, height: 48 });

      const bytes = new Uint8Array(await response!.arrayBuffer());
      expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const view = Buffer.from(bytes);
      expect([view.readUInt32BE(16), view.readUInt32BE(20)]).toEqual([frame.width, frame.height]);
    }
  });

  it("其它路由不接管（返回 undefined，fakeBackend 照走原分支）", () => {
    expect(objectFrameStub("http://backend.test/image/tech_0450")).toBeUndefined();
    expect(objectFrameStub("http://backend.test/objects/ct_0001")).toBeUndefined();
  });
});
