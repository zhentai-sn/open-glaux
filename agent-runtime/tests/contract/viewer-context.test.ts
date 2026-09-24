/**
 * `viewer` 字段契约（`parseViewer`，SDD 10 §9.1 / §7 规则 6 / D-9 / §13）。
 *
 * 经 HTTP 命令端点下发，断言两件事：合法上下文按原样交到工具工厂；不合契约的上下文 400，
 * 不猜语义。上下文使用 `{collection, task, method, object, focus}`。
 */

import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ViewerContext } from "../../src/contracts.js";
import type { HarnessToolContext } from "../../src/pi/harness-registry.js";
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

  beforeEach(() => { vi.spyOn(console, "warn").mockImplementation(() => undefined); });

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
    it.each([
      [FIXTURE_OBJECT_IDS.image, "image", "carotid_imt", []],
      [FIXTURE_OBJECT_IDS.ct, "volume", "ct_abdomen", [{ name: "z", size: 100 }]],
      [FIXTURE_OBJECT_IDS.slide, "slide", "pathology", [{ name: "level", size: 4 }]],
      [FIXTURE_OBJECT_IDS.video, "video", "video", [{ name: "t", size: 30 }]],
    ] as const)("%s: 对象与焦点原样进入工具", async (id, kind, collection, thirdAxis) => {
      const object = { id, kind, axes: [{ name: "x", size: 640 }, { name: "y", size: 480 }, ...thirdAxis], calibration: null };
      const index = kind === "volume" ? { z: 0 } : kind === "slide" ? { level: 0 } : kind === "video" ? { t: 0 } : {};
      const focus = { object_id: id, kind, index, region: null };
      expect(await delivered({ collection, task: "example", method: "reference", object, focus })).toEqual({ collection, task: "example", method: "reference", object, focus });
    });

    it("WSI 框区域保持角点语义", async () => {
      const object = { id: FIXTURE_OBJECT_IDS.slide, kind: "slide", axes: [{ name: "x", size: 3000 }, { name: "y", size: 3000 }, { name: "level", size: 4 }], calibration: null };
      const region = { kind: "box", x0: 1000, y0: 2000, x1: 1512, y1: 2512 };
      const focus = { object_id: object.id, kind: "slide", index: { level: 0 }, region };
      expect((await delivered({ object, focus }))?.focus?.region).toEqual(region);
    });

    it("只选数据集与空对象均可下发", async () => {
      expect(await delivered({ collection: "pathology" })).toEqual({ collection: "pathology" });
      expect(await delivered({})).toEqual({});
      expect(await delivered(undefined)).toBeUndefined();
      expect(await delivered(null)).toBeUndefined();
    });

    it("未知字段不进入工具", async () => {
      expect(await delivered({ collection: "video", frame_rate: 25 })).toEqual({ collection: "video" });
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

    it.each(["image_id", "modality", "cubs_cf", "roi_box"])("拒绝旧字段 %s", async (key) => {
      expect(await rejected({ [key]: "old" })).toMatchObject({
        code: "invalid_request",
        message: `viewer.${key} must be omitted; use object/focus.`,
      });
    });

    it("新旧字段双发也拒绝", async () => {
      const object = { id: FIXTURE_OBJECT_IDS.ct, kind: "volume", axes: [{ name: "x", size: 512 }, { name: "y", size: 512 }, { name: "z", size: 100 }], calibration: null };
      const focus = { object_id: object.id, kind: "volume", index: { z: 0 }, region: null };
      expect((await rejected({ object, focus, image_id: object.id })).message).toContain("viewer.image_id");
    });

    it.each(["collection", "task", "method"])("viewer.%s 不是字符串", async (key) => {
      expect((await rejected({ [key]: 1 })).message).toBe(`viewer.${key} must be a string.`);
    });

    it("新字段的对象与焦点必须同时提供且 id 一致", async () => {
      const object = { id: FIXTURE_OBJECT_IDS.ct, kind: "volume", axes: [{ name: "x", size: 512 }, { name: "y", size: 512 }, { name: "z", size: 100 }], calibration: null };
      expect((await rejected({ object })).message).toContain("viewer.object/focus");
      expect((await rejected({ object, focus: { object_id: "other", kind: "volume", index: { z: 0 }, region: null } })).message).toContain("viewer.focus.object_id");
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
