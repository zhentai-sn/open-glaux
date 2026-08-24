/**
 * 分割后端客户端（SDD 02 §7.2）。
 *
 * 用 fake fetch 覆盖 2026-08-24 对 Gitee AI `sam3` 的实测行为：prompt 必传、
 * 余额不足走 400（非 402）、0 命中不是错误、超时重试一次。响应体取自真实 fixture。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { SegmentationClient } from "../../src/annotation/segmentation-client.js";
import { RuntimeError } from "../../src/errors.js";

const fixture = readFileSync(
  fileURLToPath(new URL("../fixtures/sam3-segmentation-eye.json", import.meta.url)),
  "utf8",
);

const ENV = { GLAUX_SEG_API_TOKEN: "test-token" } as NodeJS.ProcessEnv;
const IMAGE = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function clientWith(fetchImpl: typeof fetch, extra: Record<string, unknown> = {}) {
  return new SegmentationClient({ fetch: fetchImpl, retries: 0, ...extra }, ENV);
}

function okResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
}

describe("SegmentationClient", () => {
  it("缺 token 时构造即抛，不发请求", () => {
    expect(() => new SegmentationClient({}, {} as NodeJS.ProcessEnv)).toThrow(RuntimeError);
  });

  it("把真实响应转成多边形结果（mask 不外泄）", async () => {
    const fetchImpl = vi.fn(async () => okResponse(fixture)) as unknown as typeof fetch;
    const results = await clientWith(fetchImpl).segment({ image: IMAGE, prompt: "eye" });

    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.label).toBe("eye");
      expect(r.confidence).toBeGreaterThan(0.9);
      expect(r.points.length).toBeGreaterThanOrEqual(3);
      expect(r.area).toBeGreaterThan(0);
      expect(r).not.toHaveProperty("mask");
    }
  });

  it("请求带上 model / prompt / image 三个 multipart 字段", async () => {
    let sent: FormData | null = null;
    const fetchImpl = vi.fn(async (_url: unknown, init: RequestInit) => {
      sent = init.body as FormData;
      return okResponse(fixture);
    }) as unknown as typeof fetch;

    await clientWith(fetchImpl).segment({ image: IMAGE, prompt: "eye" });
    expect(sent!.get("model")).toBe("sam3");
    expect(sent!.get("prompt")).toBe("eye");
    expect(sent!.get("image")).toBeInstanceOf(Blob);
  });

  it("空 prompt 本地拦下——该字段 schema 未声明但服务端必查", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(clientWith(fetchImpl).segment({ image: IMAGE, prompt: "  " })).rejects.toThrow(
      /prompt/u,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("0 命中不是错误，返回空数组（医学模态实测即此路径）", async () => {
    const fetchImpl = vi.fn(async () =>
      okResponse(JSON.stringify({ num_segments: 0, segments: [] })),
    ) as unknown as typeof fetch;
    await expect(clientWith(fetchImpl).segment({ image: IMAGE, prompt: "plaque" })).resolves.toEqual(
      [],
    );
  });

  it("余额不足（400 含“计费资源”）映射为专门错误码且不重试", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { message: "当前账户没有可用的计费资源，请购买订阅套餐" } }),
          { status: 400 },
        ),
    ) as unknown as typeof fetch;

    const client = new SegmentationClient({ fetch: fetchImpl, retries: 2 }, ENV);
    await expect(client.segment({ image: IMAGE, prompt: "eye" })).rejects.toMatchObject({
      code: "segmentation_quota_exhausted",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("未知 mask 编码直接报错，不静默产出错误几何", async () => {
    const body = JSON.parse(fixture) as { segments: Array<{ mask: { encoding: string } }> };
    body.segments[0]!.mask.encoding = "polygon_v2";
    const fetchImpl = vi.fn(async () => okResponse(JSON.stringify(body))) as unknown as typeof fetch;
    await expect(clientWith(fetchImpl).segment({ image: IMAGE, prompt: "eye" })).rejects.toThrow(
      /polygon_v2/u,
    );
  });

  it("5xx 会重试，第二次成功即返回", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? new Response("upstream boom", { status: 502 }) : okResponse(fixture);
    }) as unknown as typeof fetch;

    const client = new SegmentationClient({ fetch: fetchImpl, retries: 1 }, ENV);
    const results = await client.segment({ image: IMAGE, prompt: "eye" });
    expect(results).toHaveLength(2);
    expect(calls).toBe(2);
  });
});
