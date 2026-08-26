/**
 * `segment_region` 工具（SDD 02 §6 / §7.2 / §7.4）。
 *
 * 覆盖：无图退化、几何产出、置信度与条数过滤、0 命中如实告知、外发与 token 双门控。
 * 分割响应用真实 fixture（Gitee AI `sam3`），保证几何路径与生产一致。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { SegmentationClient } from "../../src/annotation/segmentation-client.js";
import { defaultToolFactory } from "../../src/pi/harness-registry.js";
import {
  createSegmentRegionTool,
  segmentationEgressAllowed,
  SEGMENT_REGION_TOOL_NAME,
  type SegmentRegionDetails,
} from "../../src/pi/tools/segment-region.js";
import type { ConnectionInput } from "../../src/contracts.js";

const fixture = readFileSync(
  fileURLToPath(new URL("../fixtures/sam3-segmentation-eye.json", import.meta.url)),
  "utf8",
);

/** backend 取图 + 分割后端两段都拦下：前者返回图字节，后者返回真实分割响应。 */
function fakeFetch(segmentBody: string = fixture): typeof fetch {
  return vi.fn(async (url: unknown) => {
    const href = String(url);
    if (href.includes("/image/")) {
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }
    return new Response(segmentBody, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

function toolWith(segmentBody?: string, viewer: Record<string, unknown> = { image_id: "eye_001" }) {
  const doFetch = fakeFetch(segmentBody);
  const client = new SegmentationClient(
    { fetch: doFetch, retries: 0 },
    { GLAUX_SEG_API_TOKEN: "test-token" } as NodeJS.ProcessEnv,
  );
  return createSegmentRegionTool({ viewer, client, fetch: doFetch });
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");
}

describe("segment_region 工具", () => {
  it("查看器没开图时直接告知，不发任何请求", async () => {
    const doFetch = vi.fn() as unknown as typeof fetch;
    const tool = createSegmentRegionTool({ viewer: {}, fetch: doFetch });
    const result = await tool.execute(
      "call-1",
      { target: "eye" },
      undefined,
      undefined,
      undefined,
    );
    expect(textOf(result)).toMatch(/No image is open/u);
    expect(doFetch).not.toHaveBeenCalled();
  });

  it("产出图像像素坐标的多边形，按面积从大到小", async () => {
    const result = await toolWith().execute(
      "call-2",
      { target: "eye" },
      undefined,
      undefined,
      undefined,
    );
    const details = result.details as SegmentRegionDetails;

    expect(details.kind).toBe("glaux.segment_region");
    expect(details.payload.image_id).toBe("eye_001");
    expect(details.payload.target).toBe("eye");
    expect(details.payload.regions).toHaveLength(2);

    const areas = details.payload.regions.map((r) => r.area);
    expect(areas).toEqual([...areas].sort((a, b) => b - a));
    for (const r of details.payload.regions) {
      expect(r.label).toBe("eye");
      expect(r.points.length).toBeGreaterThanOrEqual(3);
      expect(r.bbox).toHaveLength(4);
    }
  });

  it("文字结果点明这是候选而非已成标注", async () => {
    const result = await toolWith().execute(
      "call-3",
      { target: "eye" },
      undefined,
      undefined,
      undefined,
    );
    const text = textOf(result);
    expect(text).toMatch(/candidates, not annotations yet/u);
    expect(text).toMatch(/image pixels/u);
    expect(text).toMatch(/confidence 0\.9/u);
  });

  it("min_confidence 过滤掉低分区域并如实计数", async () => {
    const result = await toolWith().execute(
      "call-4",
      { target: "eye", min_confidence: 0.95 },
      undefined,
      undefined,
      undefined,
    );
    const details = result.details as SegmentRegionDetails;
    // fixture 两段置信度分别 0.9395 / 0.9428，阈值 0.95 应全部滤掉
    expect(details.payload.regions).toHaveLength(0);
    expect(details.payload.filtered_out).toBe(2);
    expect(textOf(result)).toMatch(/below the confidence threshold/u);
  });

  it("max_results 截断后仍报告被省略的条数", async () => {
    const result = await toolWith().execute(
      "call-5",
      { target: "eye", max_results: 1 },
      undefined,
      undefined,
      undefined,
    );
    const details = result.details as SegmentRegionDetails;
    expect(details.payload.regions).toHaveLength(1);
    expect(details.payload.filtered_out).toBe(1);
    expect(textOf(result)).toMatch(/1 lower-confidence region\(s\) omitted/u);
  });

  it("0 命中时明确要求模型不要编坐标（医学模态实测即此路径）", async () => {
    const empty = JSON.stringify({ num_segments: 0, segments: [] });
    const result = await toolWith(empty).execute(
      "call-6",
      { target: "plaque" },
      undefined,
      undefined,
      undefined,
    );
    const text = textOf(result);
    expect(text).toMatch(/found nothing matching/u);
    expect(text).toMatch(/Do not invent coordinates/u);
    expect((result.details as SegmentRegionDetails).payload.regions).toHaveLength(0);
  });
});

describe("segment_region 门控（SDD 02 §7.4）", () => {
  const connection = { provider: "openai", base_url: "https://api.example.com", vision: false } as ConnectionInput;

  it("segmentationEgressAllowed 缺省关闭，只认显式真值", () => {
    expect(segmentationEgressAllowed({} as NodeJS.ProcessEnv)).toBe(false);
    expect(segmentationEgressAllowed({ GLAUX_ANNOT_ALLOW_EGRESS: "0" } as NodeJS.ProcessEnv)).toBe(false);
    expect(segmentationEgressAllowed({ GLAUX_ANNOT_ALLOW_EGRESS: "1" } as NodeJS.ProcessEnv)).toBe(true);
    expect(segmentationEgressAllowed({ GLAUX_ANNOT_ALLOW_EGRESS: "true" } as NodeJS.ProcessEnv)).toBe(true);
  });

  it("外发未放行时不注册该工具", () => {
    vi.stubEnv("GLAUX_ANNOT_ALLOW_EGRESS", "");
    vi.stubEnv("GLAUX_SEG_API_TOKEN", "test-token");
    const tools = defaultToolFactory({ permissionMode: "suggest", connection });
    expect(tools.map((t) => t.name)).not.toContain(SEGMENT_REGION_TOOL_NAME);
    vi.unstubAllEnvs();
  });

  it("外发放行但无 token 时也不注册", () => {
    vi.stubEnv("GLAUX_ANNOT_ALLOW_EGRESS", "1");
    vi.stubEnv("GLAUX_SEG_API_TOKEN", "");
    const tools = defaultToolFactory({ permissionMode: "suggest", connection });
    expect(tools.map((t) => t.name)).not.toContain(SEGMENT_REGION_TOOL_NAME);
    vi.unstubAllEnvs();
  });

  it("两个条件都满足才注册", () => {
    vi.stubEnv("GLAUX_ANNOT_ALLOW_EGRESS", "1");
    vi.stubEnv("GLAUX_SEG_API_TOKEN", "test-token");
    const tools = defaultToolFactory({ permissionMode: "suggest", connection });
    expect(tools.map((t) => t.name)).toContain(SEGMENT_REGION_TOOL_NAME);
    vi.unstubAllEnvs();
  });

  it("observe 模式无任何工具——包括分割", () => {
    vi.stubEnv("GLAUX_ANNOT_ALLOW_EGRESS", "1");
    vi.stubEnv("GLAUX_SEG_API_TOKEN", "test-token");
    expect(defaultToolFactory({ permissionMode: "observe", connection })).toEqual([]);
    vi.unstubAllEnvs();
  });
});
