// 标注面板（SDD 23 §7.6、§15.3）：按标签汇总、分组列表、点选定位、标签目录管理。
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Annotation, AnnotationSummary, Label } from "../../api/types";
import { I18nProvider } from "../../i18n";
import { useLabels } from "../../store/labels";
import { useSession } from "../../store/session";
import { objectMeta } from "../../test/fixtures";
import { AnnotationPanel } from "./AnnotationPanel";

const OBJ = "wsi-1";
const FOLD: Label = { id: "lbl-1", scope: "global", name: "折叠", color: "#E4572E", description: "", sort: 0, seq: 1, count: 2 };
const BLEED: Label = { ...FOLD, id: "lbl-2", name: "出血", color: "#17BEBB", sort: 1, count: 0 };

function ann(id: string, over: Partial<Annotation> = {}): Annotation {
  return {
    id, image_id: OBJ, index: {}, primitive: { kind: "bbox", x0: 0, y0: 0, x1: 10, y1: 10 },
    label: "折叠", label_id: "lbl-1", label_color: "#E4572E", class_id: null, status: "draft", source: "manual", seq: 1,
    measures: { area: 3_000_000, unit: "um", area_unit: "um2" }, ...over,
  };
}

const SUMMARY: AnnotationSummary = {
  image_id: OBJ, unit: "um", area_unit: "um2",
  groups: [
    { kind: "catalog", label_id: "lbl-1", name: "折叠", color: "#E4572E", count: 2, area: 6_000_000, suggested: 1 },
    { kind: "unlabeled", label_id: null, name: "", color: null, count: 0, area: 0, suggested: 0 },
  ],
  total: { count: 2, area: 6_000_000, suggested: 1 },
};

function stubFetch(extra: Record<string, () => { status: number; body: unknown }> = {}) {
  const fn = vi.fn(async (url: string, init?: { method?: string }) => {
    const key = `${init?.method ?? "GET"} ${url.split("?")[0]}`;
    const routes: Record<string, () => { status: number; body: unknown }> = {
      "GET /api/annotations/summary": () => ({ status: 200, body: SUMMARY }),
      "GET /api/labels": () => ({ status: 200, body: { scope: "global", labels: [FOLD, BLEED] } }),
      ...extra,
    };
    const r = routes[key]?.() ?? { status: 404, body: {} };
    return { ok: r.status < 400, status: r.status, json: async () => r.body };
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  const object = objectMeta({ id: OBJ, modality: "pathology", kind: "slide" });
  useSession.setState({
    objects: { pathology: [object] },
    focus: { object_id: OBJ, kind: "slide", index: { level: 0 }, region: null },
    annotations: [ann("a1"), ann("a2", { status: "confirmed" }), ann("a3", { status: "suggested", source: "agent" })],
  });
  useLabels.setState({ objectId: OBJ, scope: "global", labels: [FOLD, BLEED], currentByScope: {}, request: null, locate: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const renderPanel = () => render(<I18nProvider><AnnotationPanel /></I18nProvider>);

describe("AnnotationPanel", () => {
  it("summarises by label with mm² areas and pending suggestions", async () => {
    stubFetch();
    renderPanel();
    const table = await screen.findByTestId("ann-summary");
    const rows = within(table).getAllByRole("row").map((r) => r.textContent);
    expect(rows[1]).toMatch(/折叠2\+16 mm²/u);
    expect(rows[rows.length - 1]).toMatch(/2\+16 mm²/u);
    expect(screen.getAllByTestId("ann-row")).toHaveLength(3); // 建议也列出，便于确认
  });

  it("asks the viewer to locate a clicked annotation", async () => {
    stubFetch();
    renderPanel();
    const rows = await screen.findAllByTestId("ann-row");
    fireEvent.click(within(rows[0]!).getAllByRole("button")[0]!);
    expect(useLabels.getState().locate?.id).toBe("a1");
  });

  it("disables deleting a label that annotations use and merges instead", async () => {
    const fetch = stubFetch({
      "POST /api/labels/lbl-1/merge": () => ({ status: 200, body: { label: BLEED } }),
      "GET /api/annotations": () => ({ status: 200, body: { annotations: [] } }),
    });
    renderPanel();
    fireEvent.click(screen.getByRole("tab", { name: /标签|Labels/u }));
    const [foldRow] = screen.getAllByTestId("label-row");
    const del = within(foldRow!).getByRole("button", { name: /删除|Delete/u });
    expect(del).toBeDisabled();
    fireEvent.change(within(foldRow!).getByRole("combobox"), { target: { value: "lbl-2" } });
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/labels/lbl-1/merge", expect.objectContaining({ method: "POST" })));
  });

  it("creates a label from the labels tab", async () => {
    const fetch = stubFetch({ "POST /api/labels": () => ({ status: 201, body: { label: { ...BLEED, id: "lbl-3", name: "坏死" } } }) });
    renderPanel();
    fireEvent.click(screen.getByRole("tab", { name: /标签|Labels/u }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "坏死" } });
    fireEvent.submit(screen.getByRole("textbox").closest("form")!);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/labels", expect.objectContaining({ method: "POST" })));
  });

  it("shows an empty state without an object", () => {
    useSession.setState({ focus: null });
    stubFetch();
    renderPanel();
    expect(screen.getByText(/舞台上没有打开的对象|Nothing is open/u)).toBeTruthy();
  });
});
