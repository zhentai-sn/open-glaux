import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Context,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import type { AtlasExemplar } from "../../src/atlas/client.js";
import type { TransportEvent } from "../../src/contracts.js";
import { defaultToolFactory } from "../../src/pi/harness-registry.js";
import {
  ATLAS_REFERENCED_DETAILS_KIND,
  CONSULT_ATLAS_TOOL_NAME,
  createConsultAtlasTool,
} from "../../src/pi/tools/consult-atlas.js";
import { RUN_TASK_TOOL_NAME } from "../../src/pi/tools/run-task.js";
import type { VisionRuntime } from "../../src/pi/vision.js";
import { TEST_CONNECTION, createRuntimeFixture, waitFor } from "../helpers/runtime-fixture.js";

// SDD 03 D-21：`consult_atlas` 是图谱接入会话的宿主。覆盖——有图走 VLM 挑选并带上目标图、
// 无图退化为纯检索、0 命中如实说明、案例图进模型且 details 走 glaux.atlas_referenced、
// 记引用失败不拖垮查阅、非视觉连接不挂该工具、卡片 details 随会话历史持久化且不带 base64。

const CROP_BYTES = "png-bytes";
const CROP_B64 = Buffer.from(CROP_BYTES).toString("base64");
const TARGET_BYTES = "target-png-bytes";

function ex(id: string, egress: "shareable" | "local-only" = "shareable"): AtlasExemplar {
  return {
    exemplar_id: id,
    image_ref: `images/${id}.png`,
    crop_ref: `images/${id}__c.png`,
    roi: [0, 0, 10, 10],
    geometry: null,
    tags: ["tem", "edd"],
    tags_raw: ["TEM", "EDD"],
    caption: `caption ${id}`,
    notes: null,
    description: { summary: `summary ${id}` },
    describe_status: "done",
    source_type: "textbook",
    source: {},
    egress,
    status: "active",
    created_at: "2026-08-16T00:00:00Z",
    score: 1,
    matched_tags: ["edd"],
  };
}

function fakeBackend(
  all: AtlasExemplar[],
  options: { imageStatus?: number; referencedStatus?: number } = {},
) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({
      method: init?.method ?? "GET",
      url,
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
    });
    const u = new URL(url);
    if (u.pathname === "/atlas/exemplars/search") {
      const egress = u.searchParams.get("egress");
      const rows = egress === "any" ? all : all.filter((e) => e.egress === "shareable");
      return new Response(JSON.stringify(rows), { headers: { "content-type": "application/json" } });
    }
    if (u.pathname.endsWith("/crop")) return new Response(Buffer.from(CROP_BYTES));
    if (u.pathname === "/atlas/exemplars/referenced") {
      return new Response("{}", { status: options.referencedStatus ?? 200 });
    }
    if (u.pathname.startsWith("/image/")) {
      if (options.imageStatus && options.imageStatus !== 200) {
        return new Response("nf", { status: options.imageStatus });
      }
      return new Response(Buffer.from(TARGET_BYTES), { headers: { "content-type": "image/png" } });
    }
    return new Response("nf", { status: 404 });
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, calls };
}

function visionRuntime(answers: string[]): { rt: VisionRuntime; contexts: Context[] } {
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
  return { rt: { models, model: faux.getModel() }, contexts };
}

const HOSTED = { provider: "openai-compatible", base_url: "https://api.example.com/v1" };

function toolFor(
  fetchImpl: typeof fetch,
  rt: VisionRuntime,
  viewer?: { image_id?: string },
) {
  return createConsultAtlasTool({
    runtime: rt,
    connection: HOSTED,
    fetch: fetchImpl,
    backendBaseUrl: "http://backend.test",
    ...(viewer ? { viewer } : {}),
  });
}

describe("consult_atlas tool (unit)", () => {
  it("compares candidates against the viewer image, returns case images and the card payload", async () => {
    const all = [ex("a"), ex("b"), ex("c"), ex("d"), ex("e")];
    const { fetch, calls } = fakeBackend(all);
    const { rt, contexts } = visionRuntime([JSON.stringify({ selected: ["c", "a"] })]);
    const tool = toolFor(fetch, rt, { image_id: "tech_402" });

    const result = await tool.execute("call-1", { q: "EDD", k: 2 }, undefined, undefined, undefined);

    // 目标图取自查看器当前图，并作为第一张图进入挑选调用
    expect(calls.some((c) => c.url === "http://backend.test/image/tech_402")).toBe(true);
    const selectContent = contexts[0]?.messages[0]?.content as { type: string; data?: string }[];
    expect(selectContent[1]).toMatchObject({
      type: "image",
      data: Buffer.from(TARGET_BYTES).toString("base64"),
    });

    expect(result.details).toEqual({
      kind: ATLAS_REFERENCED_DETAILS_KIND,
      payload: {
        trace_id: expect.any(String),
        candidate_ids: ["a", "b", "c", "d", "e"],
        selected_ids: ["c", "a"],
        excluded_by_egress: 0,
        snapshots: [
          { exemplar_id: "c", caption: "caption c", tags: ["TEM", "EDD"] },
          { exemplar_id: "a", caption: "caption a", tags: ["TEM", "EDD"] },
        ],
      },
    });

    // 案例图真的进了工具结果（这正是修好 vision 通道后才有意义的部分）
    const images = result.content.filter((c) => c.type === "image");
    expect(images).toHaveLength(2);
    expect(images[0]).toMatchObject({ data: CROP_B64, mimeType: "image/png" });
    const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
    expect(text).toContain("id: c");
    expect(text).toContain("summary c");
    expect(text).toContain("visual similarity");

    // 记引用：溯源 + "被引用过的案例不可硬删"（SDD 03 D-13）
    const referenced = calls.find((c) => c.url.endsWith("/atlas/exemplars/referenced"));
    expect(referenced?.body).toMatchObject({ exemplar_ids: ["c", "a"] });
  });

  it("without an open image: no VLM selection, top-k by search order", async () => {
    const { fetch, calls } = fakeBackend([ex("a"), ex("b"), ex("c"), ex("d"), ex("e")]);
    const { rt, contexts } = visionRuntime([]);
    const tool = toolFor(fetch, rt);

    const result = await tool.execute("c", { q: "EDD" }, undefined, undefined, undefined);

    expect(contexts).toHaveLength(0); // 没有对照图就不该发挑选调用
    expect(calls.some((c) => c.url.startsWith("http://backend.test/image/"))).toBe(false);
    expect(result.details.payload.selected_ids).toEqual(["a", "b", "c"]);
    const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
    expect(text).toContain("no image is open in the viewer");
  });

  it("falls back to text-only search when the viewer image cannot be fetched", async () => {
    const { fetch } = fakeBackend([ex("a"), ex("b"), ex("c"), ex("d")], { imageStatus: 404 });
    const { rt, contexts } = visionRuntime([]);
    const tool = toolFor(fetch, rt, { image_id: "missing_image" });

    const result = await tool.execute("c", {}, undefined, undefined, undefined);

    expect(contexts).toHaveLength(0);
    expect(result.details.payload.selected_ids).toHaveLength(3);
  });

  it("no match: says so plainly, sends no image, records no reference", async () => {
    const { fetch, calls } = fakeBackend([]);
    const { rt } = visionRuntime([]);
    const tool = toolFor(fetch, rt, { image_id: "tech_402" });

    const result = await tool.execute("c", { q: "nothing" }, undefined, undefined, undefined);

    expect(result.content.every((c) => c.type === "text")).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("no matching case");
    expect(result.details.payload.selected_ids).toEqual([]);
    expect(calls.some((c) => c.url.endsWith("/atlas/exemplars/referenced"))).toBe(false);
  });

  it("reports egress-withheld local-only cases and keeps them out of the result", async () => {
    const all = [ex("a"), ex("local-1", "local-only"), ex("local-2", "local-only")];
    const { fetch } = fakeBackend(all);
    const { rt } = visionRuntime([]);
    const tool = toolFor(fetch, rt, { image_id: "tech_402" });

    const result = await tool.execute("c", {}, undefined, undefined, undefined);

    expect(result.details.payload.selected_ids).toEqual(["a"]);
    expect(result.details.payload.excluded_by_egress).toBe(2);
    const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
    expect(text).toContain("2 local-only case(s) withheld");
  });

  it("a failing mark_referenced does not sink the consultation", async () => {
    const { fetch } = fakeBackend([ex("a")], { referencedStatus: 503 });
    const { rt } = visionRuntime([]);
    const tool = toolFor(fetch, rt, { image_id: "tech_402" });

    const result = await tool.execute("c", {}, undefined, undefined, undefined);

    expect(result.details.payload.selected_ids).toEqual(["a"]);
    expect(result.content.some((c) => c.type === "image")).toBe(true);
  });
});

describe("default tool factory · atlas gating", () => {
  const runtime = { models: createModels(), model: {} as never, disposeCredential() {} };

  it("mounts consult_atlas only when the connection declares vision", () => {
    const withVision = defaultToolFactory({
      permissionMode: "controlled",
      connection: { ...TEST_CONNECTION, vision: true },
      runtime,
    });
    expect(withVision.map((t) => t.name)).toEqual([RUN_TASK_TOOL_NAME, CONSULT_ATLAS_TOOL_NAME]);

    const withoutVision = defaultToolFactory({
      permissionMode: "controlled",
      connection: TEST_CONNECTION,
      runtime,
    });
    expect(withoutVision.map((t) => t.name)).toEqual([RUN_TASK_TOOL_NAME]);
  });

  it("observe mode has no tools at all, vision or not", () => {
    expect(
      defaultToolFactory({
        permissionMode: "observe",
        connection: { ...TEST_CONNECTION, vision: true },
        runtime,
      }),
    ).toEqual([]);
  });
});

describe("consult_atlas through the harness (integration)", () => {
  it("runs the tool and keeps the card payload in session history without the base64 images", async () => {
    const { fetch } = fakeBackend([ex("a"), ex("b")]);
    const fixture = await createRuntimeFixture(
      [
        [
          fauxAssistantMessage(fauxToolCall(CONSULT_ATLAS_TOOL_NAME, { q: "EDD" }), {
            stopReason: "toolUse",
          }),
          fauxAssistantMessage("Case a shows subepithelial deposits."),
        ],
      ],
      {
        toolFactory: ({ viewer, runtime }) => [
          createConsultAtlasTool({
            runtime: runtime as VisionRuntime,
            connection: HOSTED,
            fetch,
            backendBaseUrl: "http://backend.test",
            ...(viewer ? { viewer } : {}),
          }),
        ],
      },
    );
    const sessionId = crypto.randomUUID();
    const events: TransportEvent[] = [];
    try {
      await fixture.sessions.createSession({ session_id: sessionId });
      fixture.registry.subscribe(sessionId, (event) => events.push(event));
      await fixture.commands.accept(sessionId, {
        command_id: crypto.randomUUID(),
        type: "prompt",
        content: "what does EDD look like?",
        connection: { ...TEST_CONNECTION, vision: true },
        viewer: { image_id: "tech_402" },
      });
      await fixture.registry.waitForIdle(sessionId);
      const isToolEnd = (e: TransportEvent) =>
        e.event === "pi.event" && (e.data.event as { type?: string }).type === "tool_execution_end";
      await waitFor(() => events.some(isToolEnd));

      const toolEnd = events.find(isToolEnd) as Extract<TransportEvent, { event: "pi.event" }>;
      expect((toolEnd.data.event as { toolName: string }).toolName).toBe(CONSULT_ATLAS_TOOL_NAME);
      expect((toolEnd.data.event as { result: { details: unknown } }).result.details).toMatchObject({
        kind: ATLAS_REFERENCED_DETAILS_KIND,
        payload: { selected_ids: ["a", "b"] },
      });

      const view = await fixture.sessions.getSession(sessionId);
      const card = view.messages.find(
        (m) => (m as { role?: string }).role === "toolResult",
      ) as { details?: { kind?: string }; content?: unknown[] } | undefined;
      expect(card?.details?.kind).toBe(ATLAS_REFERENCED_DETAILS_KIND);
      expect(card?.content).toEqual([]); // 案例图不进快照，前端另经 /atlas/.../crop 取
      expect(JSON.stringify(view.messages)).not.toContain(CROP_B64);
    } finally {
      await fixture.close();
    }
  });
});
