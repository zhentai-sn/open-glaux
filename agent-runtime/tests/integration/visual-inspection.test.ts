/** SDD 22 §15.1、§15.3：看图缩放与视图编号、按视图画框、修订自己的建议。 */
import { describe, expect, it } from "vitest";

import { createProposeAnnotationTool } from "../../src/pi/tools/propose-annotation.js";
import { createReviseAnnotationTool } from "../../src/pi/tools/revise-annotation.js";
import { clampRegion, createViewCurrentImageTool } from "../../src/pi/tools/view-image.js";
import { ViewRegistry } from "../../src/pi/tools/view-registry.js";
import { viewerOn } from "../helpers/viewer-fixture.js";

const ID = "img-fixture-1";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

interface Call { method: string; url: URL; body?: Record<string, unknown> }

/** 假 backend：/frame 按 roi 给 ReferenceFrame（最长边 1024，小区域按原分辨率）；/annotations 维护一张表。 */
function fakeBackend(objectSize: [number, number], annotations: Record<string, unknown>[] = []) {
  const calls: Call[] = [];
  const rows = annotations.map((a) => ({ ...a }));
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    calls.push({ method, url, ...(body ? { body } : {}) });
    if (url.pathname.endsWith("/frame")) {
      const roi = url.searchParams.get("roi")?.split(",").map(Number) ?? [0, 0, ...objectSize];
      const [x0, y0, x1, y1] = roi as [number, number, number, number];
      if (url.searchParams.has("roi") && (x1 - x0) * (y1 - y0) > 1_000_000) return new Response("too big", { status: 413 });
      const scale = Math.min(1, 1024 / Math.max(x1 - x0, y1 - y0));
      const frame = { object_id: ID, index: {}, origin: [x0, y0], scale, width: Math.round((x1 - x0) * scale), height: Math.round((y1 - y0) * scale) };
      const headers: Record<string, string> = { "content-type": "image/png", "x-glaux-frame": JSON.stringify(frame) };
      if (url.searchParams.get("overlay") === "true") {
        headers["x-glaux-overlay"] = JSON.stringify(rows.map((r, i) => ({ tag: `A${i + 1}`, annotation_id: r.id, label: r.label, status: r.status, source: r.source })));
      }
      return new Response(Buffer.from(PNG), { headers });
    }
    if (url.pathname === "/annotations" && method === "GET") return Response.json({ annotations: rows });
    if (url.pathname === "/annotations" && method === "POST") {
      const created = { id: `ann-${rows.length + 1}`, image_id: ID, seq: 1, status: "suggested", source: "agent", ...body };
      rows.push(created);
      return Response.json({ annotation: created }, { status: 201 });
    }
    const match = /^\/annotations\/([^/]+)$/u.exec(url.pathname);
    const row = match ? rows.find((r) => r.id === decodeURIComponent(match[1]!)) : undefined;
    if (!row) return new Response("nf", { status: 404 });
    if (method === "DELETE") {
      if (Number(url.searchParams.get("base_seq")) !== row.seq) return new Response("conflict", { status: 409 });
      rows.splice(rows.indexOf(row), 1);
      return new Response(null, { status: 204 });
    }
    if (method === "PATCH") {
      if (body?.base_seq !== row.seq) return new Response("conflict", { status: 409 });
      Object.assign(row, body?.primitive ? { primitive: body.primitive } : {}, body?.label ? { label: body.label } : {}, { seq: (row.seq as number) + 1 });
      return Response.json({ annotation: row });
    }
    return new Response("bad", { status: 400 });
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, calls, rows };
}

const text = (r: { content: Array<{ type: string; text?: string }> }) => r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
const frames = (calls: Call[]) => calls.filter((c) => c.url.pathname.endsWith("/frame"));

function viewer(size: [number, number]) {
  const v = viewerOn(ID);
  v.object!.axes = [{ name: "x", size: size[0] }, { name: "y", size: size[1] }];
  return v;
}

describe("view_current_image zoom", () => {
  it("clamps regions to the object and rejects invalid ones", () => {
    expect(clampRegion([-50, 10, 300, 900], [800, 600])).toEqual([0, 10, 300, 600]);
    expect(clampRegion([900, 0, 1000, 10], [800, 600])).toMatch(/does not overlap/u);
    expect(clampRegion([10, 10, 5, 20], [800, 600])).toMatch(/x0 < x1/u);
  });

  it("numbers views, reports the mapping and overlay legend, and zooms with region", async () => {
    const backend = fakeBackend([4000, 3000], [{ id: "ann-1", label: "plaque", status: "suggested", source: "agent", seq: 1 }]);
    const views = new ViewRegistry();
    const tool = createViewCurrentImageTool({ fetch: backend.fetch, viewer: viewer([4000, 3000]), views });

    const whole = await tool.execute("c1", {}, undefined, undefined, undefined);
    expect(text(whole)).toMatch(/View v1: .*1024×768 px .*covers object pixels x 0–4000, y 0–3000 of the 4000×3000 object; 1 picture pixel = 3\.9 object pixels/u);
    expect(text(whole)).toMatch(/A1 = ann-1 "plaque", suggested by agent/u);
    expect(whole.details.payload).toMatchObject({ view_id: "v1", region: null, overlay: 1 });

    const zoom = await tool.execute("c2", { region: [1000, 800, 1300, 1000] }, undefined, undefined, undefined);
    const req = frames(backend.calls)[1]!.url.searchParams;
    expect([req.get("roi"), req.get("size"), req.get("overlay")]).toEqual(["1000,800,1300,1000", "1024", "true"]);
    expect(text(zoom)).toMatch(/View v2: .*300×200 px .*x 1000–1300, y 800–1000.*1 picture pixel = 1 object pixels/u);
    expect(views.get("v2")?.frame.origin).toEqual([1000, 800]);

    const raw = await tool.execute("c3", { region: [0, 0, 100, 100], annotations: false }, undefined, undefined, undefined);
    expect(frames(backend.calls)[2]!.url.searchParams.get("overlay")).toBeNull();
    expect(text(raw)).toMatch(/Annotations are not drawn/u);
  });

  it("lets the backend pick the WSI level so zooming reaches finer levels", async () => {
    const backend = fakeBackend([46000, 32914]);
    const v = viewerOn(ID, { kind: "slide", index: { level: 2 } });
    v.object!.axes = [{ name: "x", size: 46000 }, { name: "y", size: 32914 }, { name: "level", size: 3 }];
    const tool = createViewCurrentImageTool({ fetch: backend.fetch, viewer: v, views: new ViewRegistry() });
    const zoom = await tool.execute("c1", { region: [35300, 4300, 36100, 5300] }, undefined, undefined, undefined);
    expect(frames(backend.calls)[0]!.url.searchParams.has("level")).toBe(false);
    expect(text(zoom)).toMatch(/View v1: /u); // 返回帧的层与焦点不同也接受
  });

  it("answers invalid or oversized regions with text instead of failing the command", async () => {
    const backend = fakeBackend([4000, 3000]);
    const tool = createViewCurrentImageTool({ fetch: backend.fetch, viewer: viewer([4000, 3000]), views: new ViewRegistry() });
    const off = await tool.execute("c1", { region: [5000, 0, 6000, 10] }, undefined, undefined, undefined);
    expect(text(off)).toMatch(/^Not viewed: region does not overlap/u);
    expect(frames(backend.calls)).toHaveLength(0);
    const big = await tool.execute("c2", { region: [0, 0, 4000, 3000] }, undefined, undefined, undefined);
    expect(text(big)).toMatch(/^Not viewed: .*HTTP 413.*Choose a smaller region/u);
  });
});

describe("drawing on a view", () => {
  it("converts view pixels with the named view, defaults to the latest, and refuses unknown views", async () => {
    const backend = fakeBackend([4000, 3000]);
    const views = new ViewRegistry();
    const v = viewer([4000, 3000]);
    const look = createViewCurrentImageTool({ fetch: backend.fetch, viewer: v, views });
    const propose = createProposeAnnotationTool({ fetch: backend.fetch, viewer: v, views });
    await look.execute("c1", {}, undefined, undefined, undefined); // v1：scale 0.256
    await look.execute("c2", { region: [1000, 800, 1300, 1000] }, undefined, undefined, undefined); // v2：origin 1000,800 scale 1

    await propose.execute("p1", { label: "a", space: "view", view_id: "v2", bbox: [10, 20, 110, 70] }, undefined, undefined, undefined);
    await propose.execute("p2", { label: "b", space: "view", bbox: [10, 20, 110, 70] }, undefined, undefined, undefined); // 缺省 → 最近 v2
    await propose.execute("p3", { label: "c", space: "view", view_id: "v1", bbox: [256, 256, 512, 512] }, undefined, undefined, undefined);
    const posts = backend.calls.filter((c) => c.method === "POST").map((c) => c.body!.primitive);
    expect(posts).toEqual([
      { kind: "bbox", x0: 1010, y0: 820, x1: 1110, y1: 870 },
      { kind: "bbox", x0: 1010, y0: 820, x1: 1110, y1: 870 },
      { kind: "bbox", x0: 1000, y0: 1000, x1: 2000, y1: 2000 },
    ]);

    const unknown = await propose.execute("p4", { label: "d", space: "view", view_id: "v9", bbox: [0, 0, 10, 10] }, undefined, undefined, undefined);
    expect(text(unknown)).toMatch(/Unknown view_id "v9"/u);
    expect(backend.calls.filter((c) => c.method === "POST")).toHaveLength(3);
  });

  it("clamps view pixels at the picture edge to the object (rounded overview width overshoots)", async () => {
    // 1280×2777：概览 scale = 1024/2777，宽取整为 472，472/scale ≈ 1280.1 越界
    const backend = fakeBackend([1280, 2777]);
    const views = new ViewRegistry();
    const v = viewer([1280, 2777]);
    await createViewCurrentImageTool({ fetch: backend.fetch, viewer: v, views }).execute("c1", {}, undefined, undefined, undefined);
    const propose = createProposeAnnotationTool({ fetch: backend.fetch, viewer: v, views });
    await propose.execute("p1", { label: "paw", space: "view", bbox: [383, 197, 472, 1030] }, undefined, undefined, undefined);
    const primitive = backend.calls.find((c) => c.method === "POST")!.body!.primitive as Record<string, number>;
    expect(primitive.x1).toBe(1280);
    expect(primitive.y1).toBe(2777);
  });
});

describe("revise_annotation", () => {
  const own = { id: "ann-1", image_id: ID, primitive: { kind: "bbox", x0: 0, y0: 0, x1: 10, y1: 10 }, label: "plaque", status: "suggested", source: "agent", seq: 1 };

  it("updates its own suggestion by view pixels and records the result", async () => {
    const backend = fakeBackend([4000, 3000], [own]);
    const views = new ViewRegistry();
    const v = viewer([4000, 3000]);
    await createViewCurrentImageTool({ fetch: backend.fetch, viewer: v, views }).execute("c1", { region: [1000, 800, 1300, 1000] }, undefined, undefined, undefined);
    const revise = createReviseAnnotationTool({ fetch: backend.fetch, viewer: v, views });
    const result = await revise.execute("r1", { annotation_id: "ann-1", action: "update", space: "view", view_id: "v1", bbox: [10, 20, 110, 70], note: "edge was off" }, undefined, undefined, undefined);
    expect(text(result)).toMatch(/Revised suggestion ann-1/u);
    expect(backend.calls.find((c) => c.method === "PATCH")!.body).toEqual({ base_seq: 1, primitive: { kind: "bbox", x0: 1010, y0: 820, x1: 1110, y1: 870 } });
    expect(result.details).toMatchObject({ kind: "glaux.annotation_revised", action: "update", annotation_id: "ann-1", note: "edge was off", annotation: { seq: 2 } });
  });

  it("withdraws its own suggestion", async () => {
    const backend = fakeBackend([4000, 3000], [own]);
    const revise = createReviseAnnotationTool({ fetch: backend.fetch, viewer: viewer([4000, 3000]), views: new ViewRegistry() });
    const result = await revise.execute("r1", { annotation_id: "ann-1", action: "withdraw" }, undefined, undefined, undefined);
    expect(text(result)).toMatch(/Withdrew suggestion ann-1/u);
    expect(backend.rows).toHaveLength(0);
    expect(result.details.reason).toBeUndefined();
  });

  it("refuses annotations it does not own, confirmed ones, kind changes and stale versions", async () => {
    const backend = fakeBackend([4000, 3000], [
      { ...own, id: "ann-user", source: "manual" },
      { ...own, id: "ann-done", status: "confirmed" },
      own,
    ]);
    const revise = createReviseAnnotationTool({ fetch: backend.fetch, viewer: viewer([4000, 3000]), views: new ViewRegistry() });
    const run = (params: Record<string, unknown>) => revise.execute("r", params as never, undefined, undefined, undefined);
    expect((await run({ annotation_id: "ann-user", action: "withdraw" })).details.reason).toBe("not_revisable");
    expect((await run({ annotation_id: "ann-done", action: "update", label: "x" })).details.reason).toBe("not_revisable");
    expect((await run({ annotation_id: "ann-1", action: "update", space: "object", polygon: [[0, 0], [5, 0], [0, 5]] })).details.reason).toBe("kind_mismatch");
    expect((await run({ annotation_id: "ann-x", action: "withdraw" })).details.reason).toBe("not_found");
    backend.rows.find((r) => r.id === "ann-1")!.seq = 7; // 读到的版本在写入前被别人改过
    const stale = createReviseAnnotationTool({
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if ((init?.method ?? "GET") === "GET") return Response.json({ annotations: [{ ...own }] });
        return backend.fetch(url, init);
      }) as unknown as typeof fetch,
      viewer: viewer([4000, 3000]),
      views: new ViewRegistry(),
    });
    expect((await stale.execute("r", { annotation_id: "ann-1", action: "update", label: "new" }, undefined, undefined, undefined)).details.reason).toBe("conflict");
    expect(backend.calls.filter((c) => c.method === "PATCH" || c.method === "DELETE")).toHaveLength(1);
  });
});
