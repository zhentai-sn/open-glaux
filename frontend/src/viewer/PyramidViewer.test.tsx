import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { objectMeta } from "../test/fixtures";
import { useSession } from "../store/session";

const h = vi.hoisted(() => {
  const viewer = {
    world: { getItemCount: () => 1 },
    viewport: {
      imageToViewerElementCoordinates: (p: { x: number; y: number }) => p,
      viewerElementToImageCoordinates: (p: { x: number; y: number }) => p,
    },
    open: vi.fn(),
    addHandler: vi.fn(),
    destroy: vi.fn(),
  };
  return { viewer, createAnnotation: vi.fn(), loadAnnotations: vi.fn(), patchAnnotation: vi.fn() };
});

vi.mock("./openseadragon", () => ({
  OpenSeadragon: { Point: class Point { constructor(public x: number, public y: number) {} } },
  makeWsiViewer: vi.fn(() => h.viewer),
  makeWsiTileSource: vi.fn(() => ({ getTileUrl: () => "/api/objects/slide-1/tiles/0/0/0" })),
}));

vi.mock("../annotation/bridge", () => ({
  createAnnotation: h.createAnnotation,
  loadAnnotations: h.loadAnnotations,
  patchAnnotation: h.patchAnnotation,
}));

import { PyramidViewer } from "./PyramidViewer";

class NoopResizeObserver {
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  vi.clearAllMocks();
  h.patchAnnotation.mockImplementation(async () => null);
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
  Element.prototype.setPointerCapture = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(new Proxy({}, { get: () => () => undefined }) as unknown as CanvasRenderingContext2D);
  const object = objectMeta({ id: "slide-1", modality: "pathology", resources: { frame: "/objects/slide-1/frame", tiles: "/objects/slide-1/tiles/{level}/{col}/{row}" } });
  useSession.setState({
    modality: "pathology",
    objects: { pathology: [object] },
    focus: { object_id: object.id, kind: object.kind, index: { level: 0 }, region: null },
    annotations: [],
    primitives: [],
    tool: "bbox",
    tasks: [],
  });
});

describe("PyramidViewer", () => {
  it("挂载瓦片且原生框选经标注写桥落库，不初始化 Annotorious", async () => {
    h.createAnnotation.mockImplementation(async (input: { image_id: string; primitive: unknown }) => ({ id: "saved-1", ...input }));
    const object = useSession.getState().objects.pathology[0];
    const focus = useSession.getState().focus!;
    const { container } = render(<PyramidViewer object={object} focus={focus} />);
    await waitFor(() => expect(h.viewer.open).toHaveBeenCalledOnce());
    const overlay = container.querySelector(".wsi-annotation-overlay")!;
    fireEvent.pointerDown(overlay, { pointerId: 1, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(overlay, { pointerId: 1, clientX: 70, clientY: 80 });
    fireEvent.pointerUp(overlay, { pointerId: 1, clientX: 70, clientY: 80 });
    await waitFor(() => expect(h.createAnnotation).toHaveBeenCalledWith({
      image_id: "slide-1",
      primitive: { kind: "bbox", x0: 10, y0: 20, x1: 70, y1: 80 },
    }));
  });

  it("过小框不落库；多边形双击完成后落为闭合折线", async () => {
    const object = useSession.getState().objects.pathology[0];
    const focus = useSession.getState().focus!;
    const { container, rerender } = render(<PyramidViewer object={object} focus={focus} />);
    await waitFor(() => expect(h.viewer.open).toHaveBeenCalledOnce());
    const overlay = container.querySelector(".wsi-annotation-overlay")!;
    fireEvent.pointerDown(overlay, { pointerId: 1, clientX: 10, clientY: 20 });
    fireEvent.pointerUp(overlay, { pointerId: 1, clientX: 20, clientY: 30 });
    expect(h.createAnnotation).not.toHaveBeenCalled();

    useSession.getState().setTool("polygon");
    rerender(<PyramidViewer object={object} focus={focus} />);
    fireEvent.click(overlay, { clientX: 10, clientY: 10 });
    fireEvent.click(overlay, { clientX: 50, clientY: 10 });
    fireEvent.click(overlay, { clientX: 30, clientY: 50 });
    fireEvent.dblClick(overlay, { clientX: 30, clientY: 50 });
    expect(h.createAnnotation).toHaveBeenCalledWith({
      image_id: "slide-1",
      primitive: { kind: "polyline", closed: true, points: [[10, 10], [50, 10], [30, 50]] },
    });
  });

  it("拖动已保存框的顶点时按 base_seq 更新标注", async () => {
    useSession.setState({
      tool: "cursor",
      annotations: [{
        id: "saved-1",
        image_id: "slide-1",
        primitive: { kind: "bbox", x0: 10, y0: 20, x1: 70, y1: 80 },
        label: "",
        status: "confirmed",
        source: "manual",
        seq: 4,
      }],
    });
    const object = useSession.getState().objects.pathology[0];
    const focus = useSession.getState().focus!;
    const { container } = render(<PyramidViewer object={object} focus={focus} />);
    await waitFor(() => expect(h.viewer.open).toHaveBeenCalledOnce());
    const overlay = container.querySelector(".wsi-annotation-overlay")!;
    const firstVertex = container.querySelector(".pyramid-vertex")!;
    fireEvent.pointerDown(firstVertex, { pointerId: 1, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(overlay, { pointerId: 1, clientX: 5, clientY: 6 });
    fireEvent.pointerUp(overlay, { pointerId: 1, clientX: 5, clientY: 6 });
    expect(h.patchAnnotation).toHaveBeenCalledWith("saved-1", 4, {
      primitive: { kind: "bbox", x0: 5, y0: 6, x1: 70, y1: 80 },
    });
  });
});
