/** SDD 23 §7.5、§15.4：list_annotations 的输出，以及建议标签不在目录时的提示。 */
import { describe, expect, it } from "vitest";

import { createListAnnotationsTool, LIST_MAX } from "../../src/pi/tools/list-annotations.js";
import { createProposeAnnotationTool } from "../../src/pi/tools/propose-annotation.js";
import { viewerOn } from "../helpers/viewer-fixture.js";

const ID = "img-fixture-1";

interface Fake { calls: URL[]; fetch: typeof fetch }

function fakeBackend(opts: { labels?: Array<{ id: string; name: string }>; rows?: Record<string, unknown>[]; createdLabelId?: string | null } = {}): Fake {
  const calls: URL[] = [];
  const labels = (opts.labels ?? []).map((l) => ({ color: "#E4572E", count: 0, ...l }));
  const rows = opts.rows ?? [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push(url);
    if (url.pathname === "/labels") return Response.json({ scope: "global", labels });
    if (url.pathname === "/annotations/summary") {
      const live = rows.filter((r) => r.status !== "rejected");
      const counted = live.filter((r) => r.status !== "suggested");
      const area = counted.reduce((s, r) => s + ((r.measures as { area: number } | null)?.area ?? 0), 0);
      return Response.json({
        unit: "um", area_unit: "um2",
        groups: [{ kind: "catalog", label_id: "lbl-1", name: "折叠", color: "#E4572E", count: counted.length, area, suggested: live.length - counted.length }],
        total: { count: counted.length, area, suggested: live.length - counted.length },
      });
    }
    if (url.pathname === "/annotations" && (init?.method ?? "GET") === "GET") return Response.json({ annotations: rows });
    if (url.pathname === "/annotations" && init?.method === "POST") {
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      return Response.json({ annotation: { id: "ann-9", image_id: ID, seq: 1, status: "suggested", source: "agent", primitive: body.primitive, label: body.label, label_id: opts.createdLabelId ?? null } }, { status: 201 });
    }
    return new Response("nf", { status: 404 });
  }) as unknown as typeof fetch;
  return { calls, fetch: impl };
}

const text = (r: { content: Array<{ type: string; text?: string }> }) => r.content.map((c) => c.text ?? "").join("\n");

function row(id: string, over: Record<string, unknown> = {}) {
  return {
    id, label: "折叠", label_id: "lbl-1", status: "draft", source: "manual", index: {},
    primitive: { kind: "bbox", x0: 0, y0: 0, x1: 10, y1: 20 }, measures: { area: 200, area_unit: "um2" }, ...over,
  };
}

describe("list_annotations", () => {
  it("reports the catalog, per-label totals and each annotation", async () => {
    const backend = fakeBackend({
      labels: [{ id: "lbl-1", name: "折叠" }],
      rows: [row("a1"), row("a2", { status: "suggested", source: "agent" }), row("a3", { status: "rejected" }),
        row("a4", { label: "主动脉", label_id: null, primitive: { kind: "polyline", points: [[1, 2], [5, 2], [3, 9]] }, measures: { area: 14, area_unit: "um2" } })],
    });
    const tool = createListAnnotationsTool({ fetch: backend.fetch, viewer: viewerOn(ID) });
    const out = text(await tool.execute("c1", {}, undefined, undefined, undefined));
    expect(out).toMatch(/Areas are in um2; .*overlaps are not merged/u);
    expect(out).toMatch(/Label catalog: "折叠"\./u);
    expect(out).toMatch(/- "折叠": 2, total area 214, 1 suggestion awaiting the user/u);
    expect(out).toMatch(/- a1 \| "折叠" \| draft \| manual \| bbox \| \[0, 0, 10, 20\] \| 200/u);
    expect(out).toMatch(/- a4 \| "主动脉" \(not in catalog\) \| draft \| manual \| polygon \| \[1, 2, 5, 9\] \| 14/u);
    expect(out).not.toMatch(/a3/u);
  });

  it("filters to the current slice by default and to all slices on request", async () => {
    const backend = fakeBackend({ rows: [] });
    const v = viewerOn(ID, { kind: "volume", index: { z: 7 } });
    const tool = createListAnnotationsTool({ fetch: backend.fetch, viewer: v });
    const current = text(await tool.execute("c1", {}, undefined, undefined, undefined));
    const summary = backend.calls.find((u) => u.pathname === "/annotations/summary")!;
    expect([summary.searchParams.get("index_from"), summary.searchParams.get("index_to")]).toEqual(["7", "7"]);
    expect(current).toMatch(/\(z 7\)[\s\S]*There are no annotations/u);
    backend.calls.length = 0;
    await tool.execute("c2", { scope: "all" }, undefined, undefined, undefined);
    expect(backend.calls.find((u) => u.pathname === "/annotations/summary")!.searchParams.has("index_from")).toBe(false);
  });

  it("does not filter WSI annotations by pyramid level", async () => {
    const backend = fakeBackend({ rows: [] });
    const tool = createListAnnotationsTool({ fetch: backend.fetch, viewer: viewerOn(ID, { kind: "slide", index: { level: 2 } }) });
    await tool.execute("c1", {}, undefined, undefined, undefined);
    expect(backend.calls.find((u) => u.pathname === "/annotations/summary")!.searchParams.has("index_from")).toBe(false);
  });

  it("truncates long lists and gives the total", async () => {
    const rows = Array.from({ length: LIST_MAX + 3 }, (_, i) => row(`a${i}`));
    const tool = createListAnnotationsTool({ fetch: fakeBackend({ rows }).fetch, viewer: viewerOn(ID) });
    const out = text(await tool.execute("c1", {}, undefined, undefined, undefined));
    expect(out).toMatch(new RegExp(`… 3 more not listed \\(${LIST_MAX + 3} in total\\)`, "u"));
  });

  it("answers plainly without an open image", async () => {
    const tool = createListAnnotationsTool({ fetch: fakeBackend().fetch, viewer: {} });
    expect(text(await tool.execute("c1", {}, undefined, undefined, undefined))).toBe("No image is open in the viewer.");
  });
});

describe("propose_annotation and the label catalog", () => {
  it("lists the catalog when the label is not in it", async () => {
    const backend = fakeBackend({ labels: [{ id: "lbl-1", name: "组织折叠" }, { id: "lbl-2", name: "出血" }] });
    const tool = createProposeAnnotationTool({ fetch: backend.fetch, viewer: viewerOn(ID) });
    const out = await tool.execute("p1", { label: "fold", space: "object", bbox: [0, 0, 10, 10] }, undefined, undefined, undefined);
    expect(text(out)).toMatch(/"fold" is not in the label catalog .*Catalog labels: "组织折叠", "出血"\./u);
    expect(out.details.payload.label_id).toBeUndefined();
  });

  it("stays quiet and carries the label id when the name matches", async () => {
    const backend = fakeBackend({ labels: [{ id: "lbl-1", name: "组织折叠" }], createdLabelId: "lbl-1" });
    const tool = createProposeAnnotationTool({ fetch: backend.fetch, viewer: viewerOn(ID) });
    const out = await tool.execute("p1", { label: "组织折叠", space: "object", bbox: [0, 0, 10, 10] }, undefined, undefined, undefined);
    expect(text(out)).not.toMatch(/catalog/u);
    expect(out.details.payload.label_id).toBe("lbl-1");
    expect(backend.calls.some((u) => u.pathname === "/labels")).toBe(false);
  });

  it("says the catalog is empty when there is none", async () => {
    const tool = createProposeAnnotationTool({ fetch: fakeBackend().fetch, viewer: viewerOn(ID) });
    const out = await tool.execute("p1", { label: "fold", space: "object", bbox: [0, 0, 10, 10] }, undefined, undefined, undefined);
    expect(text(out)).toMatch(/no label catalog yet/u);
  });
});
