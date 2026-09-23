/**
 * `propose_annotation` 工具（SDD 02 §6 / §7.3）。
 *
 * 核心不变量：落库恒为 `status=suggested` + `source=agent`——"绝不自动确认"这条
 * 非目标就靠它守住。其余覆盖几何二选一、退化拒绝、错误回传与注册规则。
 */

import { describe, expect, it, vi } from "vitest";

import { defaultToolFactory } from "../../src/pi/harness-registry.js";
import {
  createProposeAnnotationTool,
  PROPOSE_ANNOTATION_TOOL_NAME,
  type AnnotationProposedDetails,
} from "../../src/pi/tools/propose-annotation.js";
import type { ConnectionInput } from "../../src/contracts.js";
import { targetObjectId, viewerOn } from "../helpers/viewer-fixture.js";

interface Captured {
  url: string;
  body: Record<string, unknown>;
}

function fakeBackend(captured: Captured[], overrides: Record<string, unknown> = {}) {
  return vi.fn(async (url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    captured.push({ url: String(url), body });
    return new Response(
      JSON.stringify({
        annotation: {
          id: "ann_001",
          image_id: body.image_id,
          primitive: body.primitive,
          z: body.z ?? null,
          seq: 1,
          status: body.status,
          source: body.source,
          ...overrides,
        },
      }),
      { status: 201, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
}

describe("propose_annotation", () => {
  it("落库恒为 suggested + agent——agent 不能自己确认标注", async () => {
    const captured: Captured[] = [];
    const tool = createProposeAnnotationTool({
      viewer: viewerOn("img_1"),
      fetch: fakeBackend(captured),
    });

    await tool.execute(
      "c1",
      { label: "左肾", bbox: [10, 20, 60, 80] },
      undefined,
      undefined,
      undefined,
    );
    expect(captured).toHaveLength(1);
    // 建议落在查看器当前对象上
    expect(targetObjectId(captured[0]!.body)).toBe("img_1");
    expect(captured[0]!.body.status).toBe("suggested");
    expect(captured[0]!.body.source).toBe("agent");
    expect(captured[0]!.body.primitive).toEqual({ kind: "bbox", x0: 10, y0: 20, x1: 60, y1: 80 });
  });

  it("结果文字明确它在等人工确认，且要求不要重复提出", async () => {
    const tool = createProposeAnnotationTool({
      viewer: viewerOn("img_1"),
      fetch: fakeBackend([]),
    });
    const text = textOf(
      await tool.execute(
        "c2",
        { label: "nucleus", bbox: [1, 1, 5, 5] },
        undefined,
        undefined,
        undefined,
      ),
    );
    expect(text).toMatch(/awaiting their confirmation/u);
    expect(text).toMatch(/do not re-propose/u);
  });

  it("多边形原样落库为 closed polyline", async () => {
    const captured: Captured[] = [];
    const tool = createProposeAnnotationTool({
      viewer: viewerOn("img_1"),
      fetch: fakeBackend(captured),
    });
    const polygon: Array<[number, number]> = [
      [1, 1],
      [9, 2],
      [5, 9],
    ];
    const result = await tool.execute(
      "c3",
      { label: "lesion", polygon },
      undefined,
      undefined,
      undefined,
    );
    expect(captured[0]!.body.primitive).toEqual({ kind: "polyline", closed: true, points: polygon });
    const details = result.details as AnnotationProposedDetails;
    expect(details.payload.annotation_id).toBe("ann_001");
  });

  it("bbox 顺序颠倒时归一化为左上/右下", async () => {
    const captured: Captured[] = [];
    const tool = createProposeAnnotationTool({
      viewer: viewerOn("img_1"),
      fetch: fakeBackend(captured),
    });
    await tool.execute(
      "c4",
      { label: "x", bbox: [90, 70, 30, 20] },
      undefined,
      undefined,
      undefined,
    );
    expect(captured[0]!.body.primitive).toEqual({ kind: "bbox", x0: 30, y0: 20, x1: 90, y1: 70 });
  });

  it("同时给 bbox 和 polygon 时拒绝，不写库", async () => {
    const captured: Captured[] = [];
    const tool = createProposeAnnotationTool({
      viewer: viewerOn("img_1"),
      fetch: fakeBackend(captured),
    });
    const result = await tool.execute(
      "c5",
      { label: "x", bbox: [1, 1, 5, 5], polygon: [[1, 1], [2, 2], [3, 3]] },
      undefined,
      undefined,
      undefined,
    );
    expect(captured).toHaveLength(0);
    expect(textOf(result)).toMatch(/not both/u);
    expect((result.details as AnnotationProposedDetails).payload.annotation_id).toBeNull();
  });

  it("两个几何都不给时拒绝，不写库", async () => {
    const captured: Captured[] = [];
    const tool = createProposeAnnotationTool({
      viewer: viewerOn("img_1"),
      fetch: fakeBackend(captured),
    });
    const result = await tool.execute("c6", { label: "x" }, undefined, undefined, undefined);
    expect(captured).toHaveLength(0);
    expect((result.details as AnnotationProposedDetails).payload.reason).toBe("missing_geometry");
  });

  it("退化 bbox（零宽/零高）拒绝，不写库", async () => {
    const captured: Captured[] = [];
    const tool = createProposeAnnotationTool({
      viewer: viewerOn("img_1"),
      fetch: fakeBackend(captured),
    });
    const result = await tool.execute(
      "c7",
      { label: "x", bbox: [5, 5, 5, 40] },
      undefined,
      undefined,
      undefined,
    );
    expect(captured).toHaveLength(0);
    expect((result.details as AnnotationProposedDetails).payload.reason).toBe("degenerate_geometry");
  });

  it("没开图时不写库并如实说明", async () => {
    const captured: Captured[] = [];
    const tool = createProposeAnnotationTool({ viewer: {}, fetch: fakeBackend(captured) });
    const result = await tool.execute(
      "c8",
      { label: "x", bbox: [1, 1, 5, 5] },
      undefined,
      undefined,
      undefined,
    );
    expect(captured).toHaveLength(0);
    expect((result.details as AnnotationProposedDetails).payload.reason).toBe("no_image");
  });

  it("后端 422（几何越界）把原因回传给模型，便于改坐标重试", async () => {
    const doFetch = vi.fn(
      async () => new Response("INVALID_GEOMETRY: bbox 越出图像范围", { status: 422 }),
    ) as unknown as typeof fetch;
    const tool = createProposeAnnotationTool({ viewer: viewerOn("img_1"), fetch: doFetch });
    await expect(
      tool.execute(
        "c9",
        { label: "x", bbox: [1, 1, 99999, 99999] },
        undefined,
        undefined,
        undefined,
      ),
    ).rejects.toThrow(/越出图像范围/u);
  });

  it("z 透传给体数据切片", async () => {
    const captured: Captured[] = [];
    const tool = createProposeAnnotationTool({
      viewer: viewerOn("vol_1"),
      fetch: fakeBackend(captured),
    });
    await tool.execute(
      "c10",
      { label: "liver", bbox: [1, 1, 9, 9], z: 42 },
      undefined,
      undefined,
      undefined,
    );
    expect(captured[0]!.body.z).toBe(42);
  });
});

describe("propose_annotation 注册规则", () => {
  const connection = { provider: "openai", vision: false } as ConnectionInput;

  it("非 observe 模式恒挂——无外发门控（只写本机 backend）", () => {
    vi.stubEnv("GLAUX_ANNOT_ALLOW_EGRESS", "");
    vi.stubEnv("GLAUX_SEG_API_TOKEN", "");
    const tools = defaultToolFactory({ permissionMode: "suggest", connection });
    expect(tools.map((t) => t.name)).toContain(PROPOSE_ANNOTATION_TOOL_NAME);
    vi.unstubAllEnvs();
  });

  it("observe 模式不挂", () => {
    const tools = defaultToolFactory({ permissionMode: "observe", connection });
    expect(tools.map((t) => t.name)).not.toContain(PROPOSE_ANNOTATION_TOOL_NAME);
  });
});
