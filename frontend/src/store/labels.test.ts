// 标签目录 store（SDD 23 §7.1–§7.2）：绘制取标签、弹层兑现、作用域记忆、同名新建取回已有。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Label } from "../api/types";
import { chooseLabelForDrawing, currentLabel, useLabels } from "./labels";

const FOLD: Label = { id: "lbl-1", scope: "prj-a", name: "折叠", color: "#E4572E", description: "", sort: 0, seq: 1, count: 0 };
const BLEED: Label = { ...FOLD, id: "lbl-2", name: "出血", color: "#17BEBB", sort: 1 };

function stubFetch(routes: Record<string, () => { status: number; body: unknown }>) {
  const fn = vi.fn(async (url: string, init?: { method?: string }) => {
    const key = `${init?.method ?? "GET"} ${url.split("?")[0]}`;
    const r = routes[key]?.() ?? { status: 404, body: {} };
    return { ok: r.status < 400, status: r.status, json: async () => r.body };
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  useLabels.setState({ objectId: null, scope: null, labels: [], currentByScope: {}, showNames: true, request: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chooseLabelForDrawing", () => {
  it("uses the current label of the object's scope without asking", async () => {
    stubFetch({ "GET /api/labels": () => ({ status: 200, body: { scope: "prj-a", labels: [FOLD, BLEED] } }) });
    useLabels.setState({ currentByScope: { "prj-a": "lbl-2" } });
    await expect(chooseLabelForDrawing("img-1")).resolves.toMatchObject({ id: "lbl-2" });
    expect(useLabels.getState().request).toBeNull();
  });

  it("asks when there is no current label, and remembers the choice for the scope", async () => {
    stubFetch({ "GET /api/labels": () => ({ status: 200, body: { scope: "prj-a", labels: [FOLD, BLEED] } }) });
    const pending = chooseLabelForDrawing("img-1");
    await vi.waitFor(() => expect(useLabels.getState().request).not.toBeNull());
    useLabels.getState().settle(BLEED);
    await expect(pending).resolves.toEqual(BLEED);
    expect(currentLabel()?.id).toBe("lbl-2");
  });

  it("resolves null when the user cancels", async () => {
    stubFetch({ "GET /api/labels": () => ({ status: 200, body: { scope: "prj-a", labels: [] } }) });
    const pending = chooseLabelForDrawing("img-1");
    await vi.waitFor(() => expect(useLabels.getState().request).not.toBeNull());
    useLabels.getState().settle(null);
    await expect(pending).resolves.toBeNull();
    expect(currentLabel()).toBeNull();
  });

  it("keeps a separate current label per scope", async () => {
    useLabels.setState({ currentByScope: { "prj-a": "lbl-1" } });
    stubFetch({ "GET /api/labels": () => ({ status: 200, body: { scope: "global", labels: [] } }) });
    await useLabels.getState().load("img-2");
    expect(currentLabel()).toBeNull();
  });
});

describe("catalog edits", () => {
  it("returns the existing label when creating a duplicate name", async () => {
    stubFetch({
      "POST /api/labels": () => ({ status: 409, body: { detail: { code: "LABEL_EXISTS", message: "dup", label: FOLD } } }),
      "GET /api/labels": () => ({ status: 200, body: { scope: "prj-a", labels: [FOLD] } }),
    });
    await expect(useLabels.getState().createLabel("img-1", "折叠 ")).resolves.toEqual(FOLD);
  });

  it("reports how many annotations block a delete", async () => {
    useLabels.setState({ objectId: "img-1", scope: "prj-a", labels: [FOLD] });
    stubFetch({ "DELETE /api/labels/lbl-1": () => ({ status: 409, body: { detail: { code: "LABEL_IN_USE", message: "in use", count: 4 } } }) });
    await expect(useLabels.getState().deleteLabel("lbl-1")).resolves.toEqual({ ok: false, count: 4 });
  });

  it("moves the current label to the merge target", async () => {
    useLabels.setState({ objectId: "img-1", scope: "prj-a", labels: [FOLD, BLEED], currentByScope: { "prj-a": "lbl-1" } });
    stubFetch({
      "POST /api/labels/lbl-1/merge": () => ({ status: 200, body: { label: BLEED } }),
      "GET /api/labels": () => ({ status: 200, body: { scope: "prj-a", labels: [BLEED] } }),
    });
    await expect(useLabels.getState().mergeLabel("lbl-1", "lbl-2")).resolves.toBe(true);
    expect(currentLabel()?.id).toBe("lbl-2");
  });
});
