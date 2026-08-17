import { createModels, fauxAssistantMessage, fauxProvider, type Context } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { AtlasClient, egressFor, type AtlasExemplar } from "../../src/atlas/client.js";
import { selectExemplars } from "../../src/atlas/select.js";
import type { VisionRuntime } from "../../src/pi/vision.js";

// SDD 03 §6.3 / §7.4 / §12：候选 0 直返、≤3 跳过挑选、≥4 走 VLM 挑选；egress 过滤计数；
// atlas.referenced payload 形状；egressFor 只对回环 base_url 放开 any。

const PNG = "iVBORw0KGgo=";

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

function fakeBackend(all: AtlasExemplar[]) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(`${init?.method ?? "GET"} ${url}`);
    const u = new URL(url);
    if (u.pathname === "/atlas/exemplars/search") {
      const egress = u.searchParams.get("egress");
      const rows = egress === "any" ? all : all.filter((e) => e.egress === "shareable");
      return new Response(JSON.stringify(rows), { headers: { "content-type": "application/json" } });
    }
    if (u.pathname.endsWith("/crop")) return new Response(Buffer.from("png-bytes"));
    if (u.pathname === "/atlas/exemplars/referenced") return new Response("{}");
    return new Response("nf", { status: 404 });
  }) as unknown as typeof fetch;
  return { client: new AtlasClient({ baseUrl: "http://127.0.0.1:8000", fetch: fetchImpl }), calls };
}

function runtimeWith(answers: string[]): { rt: VisionRuntime; contexts: Context[] } {
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

describe("selectExemplars", () => {
  it("0 candidates → empty result, no VLM call, event has empty ids", async () => {
    const { client, calls } = fakeBackend([]);
    const { rt, contexts } = runtimeWith([]);
    const r = await selectExemplars(rt, client, { egress: "any", target: { data: PNG }, traceId: "t0", q: "x" });
    expect(r.candidates).toEqual([]);
    expect(r.selected).toEqual([]);
    expect(r.event).toEqual({ trace_id: "t0", candidate_ids: [], selected_ids: [], excluded_by_egress: 0, snapshots: [] });
    expect(contexts).toHaveLength(0);
    expect(calls.filter((c) => c.includes("/crop"))).toHaveLength(0);
  });

  it("≤3 candidates → all selected without VLM; crops fetched as base64", async () => {
    const { client } = fakeBackend([ex("a"), ex("b")]);
    const { rt, contexts } = runtimeWith([]);
    const r = await selectExemplars(rt, client, { egress: "any", target: { data: PNG }, traceId: "t1" });
    expect(r.selected.map((s) => s.exemplar_id)).toEqual(["a", "b"]);
    expect(r.selected[0]!.crop_base64).toBe(Buffer.from("png-bytes").toString("base64"));
    expect(contexts).toHaveLength(0);
    expect(r.event.snapshots).toEqual([
      { exemplar_id: "a", caption: "caption a", tags: ["TEM", "EDD"] },
      { exemplar_id: "b", caption: "caption b", tags: ["TEM", "EDD"] },
    ]);
  });

  it("≥4 candidates → one VLM selection call with all crops; picks in model order, k=3", async () => {
    const { client } = fakeBackend([ex("a"), ex("b"), ex("c"), ex("d"), ex("e")]);
    const { rt, contexts } = runtimeWith(['{"selected":["d","b","zzz","a","e"]}']);
    const r = await selectExemplars(rt, client, { egress: "any", target: { data: PNG }, traceId: "t2", tags: ["EDD"] });
    expect(r.candidates).toHaveLength(5);
    expect(r.selected.map((s) => s.exemplar_id)).toEqual(["d", "b", "a"]);
    expect(contexts).toHaveLength(1);
    const blocks = contexts[0]!.messages[0]!.content as { type: string }[];
    expect(blocks.filter((b) => b.type === "image")).toHaveLength(6); // 目标 + 5 候选
    expect(r.event.selected_ids).toEqual(["d", "b", "a"]);
  });

  it("falls back to top-k by retrieval order when the model picks no valid id", async () => {
    const { client } = fakeBackend([ex("a"), ex("b"), ex("c"), ex("d")]);
    const { rt } = runtimeWith(['{"selected":["nope"]}']);
    const r = await selectExemplars(rt, client, { egress: "any", target: { data: PNG }, traceId: "t3", k: 2 });
    expect(r.selected.map((s) => s.exemplar_id)).toEqual(["a", "b"]);
  });

  it("egress=shareable excludes local-only and reports the excluded count", async () => {
    const { client, calls } = fakeBackend([ex("a"), ex("l1", "local-only"), ex("l2", "local-only")]);
    const { rt } = runtimeWith([]);
    const r = await selectExemplars(rt, client, { egress: "shareable", target: { data: PNG }, traceId: "t4" });
    expect(r.candidates.map((c) => c.exemplar_id)).toEqual(["a"]);
    expect(r.excluded_by_egress).toBe(2);
    expect(r.event.excluded_by_egress).toBe(2);
    expect(calls.filter((c) => c.includes("egress=shareable"))).toHaveLength(1);
    expect(calls.filter((c) => c.includes("egress=any"))).toHaveLength(1);
  });

  it("passes collection scope through to backend search (v1.1)", async () => {
    const { client, calls } = fakeBackend([ex("a")]);
    const { rt } = runtimeWith([]);
    await selectExemplars(rt, client, { egress: "any", target: { data: PNG }, traceId: "t5", collection: "肾脏/膜性肾病" });
    expect(calls.some((c) => c.includes("collection=" + encodeURIComponent("肾脏/膜性肾病")))).toBe(true);
  });

  it("markReferenced posts ids + trace_id", async () => {
    const { client, calls } = fakeBackend([]);
    await client.markReferenced(["a", "b"], "t9");
    expect(calls).toContain("POST http://127.0.0.1:8000/atlas/exemplars/referenced");
    await client.markReferenced([], "t9"); // no-op
    expect(calls.filter((c) => c.includes("referenced"))).toHaveLength(1);
  });
});

describe("egressFor", () => {
  it("hosted providers → shareable; loopback base_url → any; failures → shareable", async () => {
    expect(await egressFor({ provider: "anthropic" })).toBe("shareable");
    expect(await egressFor({ provider: "openai-compatible", base_url: "http://localhost:11434/v1" }, async () => ["127.0.0.1"])).toBe("any");
    expect(await egressFor({ provider: "openai-compatible", base_url: "http://[::1]:1234/v1" }, async () => ["::1"])).toBe("any");
    expect(await egressFor({ provider: "openai-compatible", base_url: "https://api.example.com/v1" }, async () => ["8.8.8.8"])).toBe("shareable");
    expect(await egressFor({ provider: "openai-compatible", base_url: "http://x/" }, async () => ["127.0.0.1", "10.0.0.1"])).toBe("shareable");
    expect(await egressFor({ provider: "openai-compatible", base_url: "not a url" })).toBe("shareable");
    expect(await egressFor({ provider: "openai-compatible", base_url: "http://nx.invalid/" }, async () => { throw new Error("nx"); })).toBe("shareable");
  });
});
