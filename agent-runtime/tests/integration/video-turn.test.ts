/**
 * SDD 11 视频问答一轮的受控边界：观察预算、片段元数据校验、证据校验、会话条目与 Qwen 出站媒体块。
 *
 * 后端以 stub fetch 模拟 `/objects/{id}`、`/clip`、`/frame-at`；片段字节与头部按真实协议构造，
 * 摘要由测试现算，因此元数据篡改能被逐项触发。
 */

import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Session } from "@earendil-works/pi-agent-core";

import type { ConnectionInput, EvidenceRef, VideoAnswer } from "../../src/contracts.js";
import { RuntimeError } from "../../src/errors.js";
import { createModelRuntime, VIDEO_MARKER, type VideoMediaBridge } from "../../src/pi/model-runtime.js";
import { VideoTurn } from "../../src/pi/video-turn.js";

const BACKEND = "http://backend.test";
const OBJECT_ID = "vid-aaaaaaaa-bbbbbbbb";
const SOURCE_SHA = "a".repeat(64);
const MIB = 1024 * 1024;

interface BackendOptions {
  durationMs?: number;
  hasAudio?: boolean;
  clipBytes?: number;
  sourceSha?: () => string;
  tamper?: (header: Record<string, unknown>) => void;
  clipTemplate?: string;
  frameTimeOffset?: number;
}

function sha(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function stubBackend(opts: BackendOptions = {}) {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    calls.push(`${url.pathname}${url.search}`);
    if (url.pathname === `/objects/${OBJECT_ID}`) {
      return Response.json({
        id: OBJECT_ID,
        kind: "video",
        axes: [{ name: "x", size: 640 }, { name: "y", size: 360 }, { name: "t", size: 100 }],
        meta: { duration_ms: opts.durationMs ?? 600_000 },
        resources: { clip: opts.clipTemplate ?? `/objects/${OBJECT_ID}/clip?start_ms={start_ms}&end_ms={end_ms}` },
        streams: opts.hasAudio === false ? [] : [{ kind: "audio" }],
      });
    }
    if (url.pathname === `/objects/${OBJECT_ID}/clip`) {
      const start = Number(url.searchParams.get("start_ms"));
      const end = Number(url.searchParams.get("end_ms"));
      const body = new Uint8Array(opts.clipBytes ?? 1024).fill(start % 251);
      const header: Record<string, unknown> = {
        object_id: OBJECT_ID,
        source_sha256: opts.sourceSha?.() ?? SOURCE_SHA,
        requested_interval: { start_ms: start, end_ms: end },
        actual_interval: { start_ms: start, end_ms: end },
        mime: "video/mp4",
        clip_sha256: sha(body),
        encoding: { video: "h264", audio: opts.hasAudio === false ? null : "aac" },
      };
      opts.tamper?.(header);
      return new Response(body, { headers: { "content-type": "video/mp4", "X-Glaux-Clip": JSON.stringify(header) } });
    }
    if (url.pathname === `/objects/${OBJECT_ID}/frame-at`) {
      const time = Number(url.searchParams.get("time_ms"));
      return new Response(new Uint8Array([0x89]), {
        headers: {
          "X-Glaux-Frame": JSON.stringify({ object_id: OBJECT_ID, index: { t: 1 }, origin: [0, 0], scale: 1, width: 640, height: 360 }),
          "X-Glaux-Frame-Time": String(time + (opts.frameTimeOffset ?? 0)),
          "X-Glaux-Frame-Tolerance": "100",
        },
      });
    }
    return new Response("nf", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchImpl);
  return { calls };
}

function makeTurn() {
  const entries: { type: string; data: unknown }[] = [];
  const session = {
    appendCustomEntry: vi.fn(async (type: string, data: unknown) => { entries.push({ type, data }); }),
  } as unknown as Session;
  const media = { register: vi.fn(), patch: vi.fn(), clear: vi.fn() } satisfies VideoMediaBridge;
  const answers: VideoAnswer[] = [];
  const turn = new VideoTurn(OBJECT_ID, "cmd-1", session, media, (answer) => answers.push(answer));
  return { turn, entries, media, answers };
}

async function rejects(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(RuntimeError);
  expect((error as RuntimeError).code).toBe(code);
}

beforeEach(() => {
  vi.stubEnv("GLAUX_BACKEND_URL", BACKEND);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("VideoTurn 观察预算（SDD 11 D-12）", () => {
  it("每轮最多 12 次观察，第 13 次拒绝", async () => {
    stubBackend();
    const { turn } = makeTurn();
    for (let i = 0; i < 12; i++) await turn.observe(i * 1000, i * 1000 + 1000, 2);
    await rejects(turn.observe(20_000, 21_000, 2), "observation_budget_exceeded");
  });

  it("每轮观察总时长最多 600 秒", async () => {
    stubBackend();
    const { turn } = makeTurn();
    for (let i = 0; i < 10; i++) await turn.observe(i * 60_000, (i + 1) * 60_000, 0.5);
    await rejects(turn.observe(0, 1000, 2), "observation_budget_exceeded");
  });

  it("每轮媒体字节最多 48 MiB，单片段最多 6 MiB", async () => {
    stubBackend({ clipBytes: 6 * MIB });
    const { turn } = makeTurn();
    for (let i = 0; i < 8; i++) await turn.observe(i * 1000, i * 1000 + 1000, 2);
    await rejects(turn.observe(9000, 10_000, 2), "observation_budget_exceeded");

    stubBackend({ clipBytes: 6 * MIB + 1 });
    await rejects(makeTurn().turn.observe(0, 1000, 2), "observation_budget_exceeded");
  });

  it.each([
    [0, 60_001],
    [5000, 5000],
    [-1, 1000],
    [599_500, 600_001],
    [0.5, 1000],
  ])("非法区间 %s..%s 拒绝且不请求片段", async (start, end) => {
    const { calls } = stubBackend();
    await rejects(makeTurn().turn.observe(start, end, 2), "invalid_video_interval");
    expect(calls.some((c) => c.includes("/clip"))).toBe(false);
  });

  it("超过 10 分钟的视频对象直接拒绝", async () => {
    stubBackend({ durationMs: 600_001 });
    await rejects(makeTurn().turn.observe(0, 1000, 2), "video_duration_exceeded");
  });
});

describe("VideoTurn 片段元数据校验", () => {
  it.each([
    ["实际区间超出请求", (h: Record<string, unknown>) => { h.actual_interval = { start_ms: 0, end_ms: 2000 }; }],
    ["摘要与正文不符", (h: Record<string, unknown>) => { h.clip_sha256 = "b".repeat(64); }],
    ["对象不符", (h: Record<string, unknown>) => { h.object_id = "vid-other"; }],
    ["请求区间被改写", (h: Record<string, unknown>) => { h.requested_interval = { start_ms: 0, end_ms: 999 }; }],
  ])("%s → video_clip_failed", async (_label, tamper) => {
    stubBackend({ tamper });
    await rejects(makeTurn().turn.observe(0, 1000, 2), "video_clip_failed");
  });

  it("片段模板指向非后端地址时拒绝", async () => {
    stubBackend({ clipTemplate: "http://evil.test/clip?start_ms={start_ms}&end_ms={end_ms}" });
    await rejects(makeTurn().turn.observe(0, 1000, 2), "video_clip_failed");
  });

  it("同一轮内源指纹变化时拒绝后续观察", async () => {
    let n = 0;
    stubBackend({ sourceSha: () => (n++ === 0 ? SOURCE_SHA : "c".repeat(64)) });
    const { turn } = makeTurn();
    await turn.observe(0, 1000, 2);
    await rejects(turn.observe(1000, 2000, 2), "video_source_changed");
  });
});

describe("VideoTurn 会话条目不含媒体正文", () => {
  it("观察条目只记元数据，字节只交给媒体桥", async () => {
    stubBackend({ clipBytes: 64 * 1024 });
    const { turn, entries, media } = makeTurn();
    const observation = await turn.observe(0, 1000, 2);
    expect(media.register).toHaveBeenCalledWith(observation.observation_id, expect.any(Uint8Array), 2);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.type).toBe("glaux.video.observation");
    const persisted = JSON.stringify(entries[0]!.data);
    expect(persisted.length).toBeLessThan(2048);
    expect(persisted).not.toMatch(/base64|data:/u);
    expect(entries[0]!.data).toMatchObject({ command_id: "cmd-1", observation_id: observation.observation_id });
  });

  it("重复观察同一区间不重复写条目，观测 id 确定", async () => {
    stubBackend();
    const { turn, entries } = makeTurn();
    const a = await turn.observe(0, 1000, 2);
    const b = await turn.observe(0, 1000, 2);
    expect(a.observation_id).toBe(b.observation_id);
    expect(entries).toHaveLength(1);
  });
});

describe("VideoTurn 证据校验（SDD 11 §9）", () => {
  async function observed(opts: BackendOptions = {}) {
    const backend = stubBackend(opts);
    const ctx = makeTurn();
    const observation = await ctx.turn.observe(10_000, 20_000, 2);
    return { ...ctx, ...backend, id: observation.observation_id };
  }

  const answer = (evidence: EvidenceRef[]): VideoAnswer => ({
    object_id: OBJECT_ID,
    claims: [{ text: "有人说话", evidence }],
    unanswered: [],
  });

  it("合法视觉证据会去后端复核关键帧，并写入回答条目", async () => {
    const { turn, id, calls, entries, answers } = await observed();
    await turn.submit(answer([{
      observation_id: id, kind: "av", source_interval: { start_ms: 12_000, end_ms: 13_000 },
      frame_time_ms: 12_500, region: { kind: "box", x0: 10, y0: 10, x1: 100, y1: 100 },
    }]));
    expect(calls.some((c) => c.startsWith(`/objects/${OBJECT_ID}/frame-at?time_ms=12500&source_sha256=${SOURCE_SHA}`))).toBe(true);
    expect(entries.map((e) => e.type)).toEqual(["glaux.video.observation", "glaux.video.answer"]);
    expect(answers).toHaveLength(1);
  });

  it.each<[string, (id: string) => EvidenceRef]>([
    ["未观察的观测 id", () => ({ observation_id: "f".repeat(64), kind: "visual", source_interval: { start_ms: 12_000, end_ms: 13_000 } })],
    ["区间早于观测起点", (id) => ({ observation_id: id, kind: "visual", source_interval: { start_ms: 9000, end_ms: 13_000 } })],
    ["区间晚于观测终点", (id) => ({ observation_id: id, kind: "visual", source_interval: { start_ms: 12_000, end_ms: 20_001 } })],
    ["空区间", (id) => ({ observation_id: id, kind: "visual", source_interval: { start_ms: 12_000, end_ms: 12_000 } })],
    ["音频证据带区域", (id) => ({ observation_id: id, kind: "audio", source_interval: { start_ms: 12_000, end_ms: 13_000 }, frame_time_ms: 12_500, region: { kind: "box", x0: 0, y0: 0, x1: 10, y1: 10 } })],
    ["区域越出画面", (id) => ({ observation_id: id, kind: "visual", source_interval: { start_ms: 12_000, end_ms: 13_000 }, frame_time_ms: 12_500, region: { kind: "box", x0: 0, y0: 0, x1: 641, y1: 10 } })],
    ["区域退化", (id) => ({ observation_id: id, kind: "visual", source_interval: { start_ms: 12_000, end_ms: 13_000 }, frame_time_ms: 12_500, region: { kind: "box", x0: 50, y0: 0, x1: 50, y1: 10 } })],
    ["关键帧时间在引用区间外", (id) => ({ observation_id: id, kind: "visual", source_interval: { start_ms: 12_000, end_ms: 13_000 }, frame_time_ms: 13_000, region: { kind: "box", x0: 0, y0: 0, x1: 10, y1: 10 } })],
    ["关键帧时间缺区域", (id) => ({ observation_id: id, kind: "visual", source_interval: { start_ms: 12_000, end_ms: 13_000 }, frame_time_ms: 12_500 })],
  ])("%s → invalid_video_evidence", async (_label, make) => {
    const { turn, id, entries } = await observed();
    await rejects(turn.submit(answer([make(id)])), "invalid_video_evidence");
    expect(entries.map((e) => e.type)).toEqual(["glaux.video.observation"]);
  });

  it("无音轨视频不接受声音证据", async () => {
    const { turn, id } = await observed({ hasAudio: false });
    for (const kind of ["audio", "av"] as const) {
      await rejects(turn.submit(answer([{ observation_id: id, kind, source_interval: { start_ms: 12_000, end_ms: 13_000 } }])), "invalid_video_evidence");
    }
  });

  it("后端关键帧时间偏离超过容差时拒绝", async () => {
    const { turn, id } = await observed({ frameTimeOffset: 101 });
    await rejects(turn.submit(answer([{
      observation_id: id, kind: "visual", source_interval: { start_ms: 12_000, end_ms: 13_000 },
      frame_time_ms: 12_500, region: { kind: "box", x0: 0, y0: 0, x1: 10, y1: 10 },
    }])), "invalid_video_evidence");
  });

  it("结论没有证据、对象不符或既无结论也无无法判断项时拒绝", async () => {
    const { turn } = await observed();
    await rejects(turn.submit({ object_id: OBJECT_ID, claims: [{ text: "x", evidence: [] }], unanswered: [] }), "invalid_video_answer");
    await rejects(turn.submit({ object_id: "vid-other", claims: [], unanswered: ["?"] }), "invalid_video_answer");
    await rejects(turn.submit({ object_id: OBJECT_ID, claims: [], unanswered: [] }), "invalid_video_answer");
  });

  it("每轮只接受一次回答", async () => {
    const { turn } = await observed();
    await turn.submit({ object_id: OBJECT_ID, claims: [], unanswered: ["视频中没有蜂鸣"] });
    await rejects(turn.submit({ object_id: OBJECT_ID, claims: [], unanswered: ["again"] }), "video_answer_exists");
  });

  it("观察过但没提交回答时收尾为无法判断；未观察则不写回答", async () => {
    const { turn, answers } = await observed();
    await turn.finalize();
    expect(answers).toEqual([{ object_id: OBJECT_ID, claims: [], unanswered: ["本轮没有形成可校验的证据回答"] }]);

    stubBackend();
    const idle = makeTurn();
    await idle.turn.finalize();
    expect(idle.answers).toEqual([]);
  });
});

describe("Qwen 出站媒体块（SDD 11 §9）", () => {
  const qwen: ConnectionInput = {
    provider: "openai-compatible",
    model: "qwen3.8-omni-flash",
    base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    context_window: 65_536,
    max_tokens: 8192,
    credential: "test-credential",
    vision: true,
    media_adapter: "qwen-omni",
  };
  const id = "d".repeat(64);
  const toolMessage = { role: "tool", tool_call_id: "t1", content: `${VIDEO_MARKER}${id}\nObserved source 0..1000 ms.` };

  it("工具消息只留观测 id，新观测以 user 媒体消息紧随，且只展开一次", () => {
    const media = createModelRuntime(qwen).videoMedia!;
    const bytes = new Uint8Array([1, 2, 3, 4]);
    media.register(id, bytes, 5);
    const first = media.patch({ messages: [{ role: "user", content: "q" }, { ...toolMessage }] }) as Record<string, unknown>;
    const messages = first.messages as Record<string, unknown>[];
    expect(messages[1]).toEqual(toolMessage);
    expect(messages[2]).toMatchObject({
      role: "user",
      content: [
        { type: "text" },
        { type: "video_url", video_url: { url: `data:;base64,${Buffer.from(bytes).toString("base64")}`, fps: 5 } },
      ],
    });
    expect(first).toMatchObject({ modalities: ["text"], reasoning_effort: "low" });

    const second = media.patch({ messages: [{ role: "user", content: "q" }, { ...toolMessage }] }) as Record<string, unknown>;
    expect((second.messages as unknown[]).length).toBe(2);
  });

  it("Base64 达到 10 MB 时拒发", () => {
    const media = createModelRuntime(qwen).videoMedia!;
    media.register(id, new Uint8Array(7_500_000), 2);
    expect(() => media.patch({ messages: [{ ...toolMessage }] })).toThrow(/10 MB/u);
  });

  it("非 Qwen 组合不能启用音画适配器", () => {
    expect(() => createModelRuntime({ ...qwen, model: "qwen-vl-max" })).toThrow(RuntimeError);
    expect(() => createModelRuntime({ ...qwen, vision: false })).toThrow(RuntimeError);
    expect(() => createModelRuntime({ ...qwen, base_url: "http://dashscope.aliyuncs.com/compatible-mode/v1" })).toThrow(RuntimeError);
    const { media_adapter: _adapter, ...plain } = qwen;
    expect(createModelRuntime(plain).videoMedia).toBeUndefined();
  });
});
