import { act, fireEvent, render, waitFor } from "@testing-library/react";
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

function props() {
  const state = useSession.getState();
  return {
    object: state.objects.pathology[0],
    focus: state.focus!,
    primitives: state.primitives,
    annotations: state.annotations,
    tool: state.tool,
    onRegion: state.setRegion,
    notify: state.notify,
  };
}

class NoopResizeObserver {
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  vi.clearAllMocks();
  h.createAnnotation.mockImplementation(async () => null);
  h.loadAnnotations.mockImplementation(async () => undefined);
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
    const { container } = render(<PyramidViewer {...props()} />);
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

  it("过小框不落库；多边形逐点显示顶点并点击首点闭合", async () => {
    const { container, rerender } = render(<PyramidViewer {...props()} />);
    await waitFor(() => expect(h.viewer.open).toHaveBeenCalledOnce());
    const overlay = container.querySelector(".wsi-annotation-overlay")!;
    fireEvent.pointerDown(overlay, { pointerId: 1, clientX: 10, clientY: 20 });
    fireEvent.pointerUp(overlay, { pointerId: 1, clientX: 20, clientY: 30 });
    expect(h.createAnnotation).not.toHaveBeenCalled();

    useSession.getState().setTool("polygon");
    rerender(<PyramidViewer {...props()} />);
    fireEvent.click(overlay, { clientX: 10, clientY: 10 });
    fireEvent.click(overlay, { clientX: 50, clientY: 10 });
    fireEvent.click(overlay, { clientX: 30, clientY: 50 });
    expect(container.querySelectorAll(".pyramid-draft-vertex")).toHaveLength(3);
    expect(container.querySelector(".pyramid-close-vertex")).not.toBeNull();
    fireEvent.click(container.querySelector(".pyramid-close-vertex")!, { clientX: 10, clientY: 10 });
    expect(h.createAnnotation).toHaveBeenCalledWith({
      image_id: "slide-1",
      primitive: { kind: "polyline", closed: true, points: [[10, 10], [50, 10], [30, 50]] },
    });
    expect(container.querySelectorAll(".pyramid-draft-vertex")).toHaveLength(0);
  });

  it("真实双击事件顺序不会写入重复末点，Enter 完成而 Escape 丢弃草稿", async () => {
    useSession.getState().setTool("polygon");
    const { container } = render(<PyramidViewer {...props()} />);
    await waitFor(() => expect(h.viewer.open).toHaveBeenCalledOnce());
    const overlay = container.querySelector(".wsi-annotation-overlay")!;
    fireEvent.click(overlay, { clientX: 10, clientY: 10, detail: 1 });
    fireEvent.click(overlay, { clientX: 50, clientY: 10, detail: 1 });
    fireEvent.click(overlay, { clientX: 30, clientY: 50, detail: 1 });
    fireEvent.click(overlay, { clientX: 30, clientY: 50, detail: 1 });
    fireEvent.click(overlay, { clientX: 30, clientY: 50, detail: 2 });
    fireEvent.dblClick(overlay, { clientX: 30, clientY: 50, detail: 2 });
    expect(h.createAnnotation).toHaveBeenCalledWith({
      image_id: "slide-1",
      primitive: { kind: "polyline", closed: true, points: [[10, 10], [50, 10], [30, 50]] },
    });

    fireEvent.click(overlay, { clientX: 20, clientY: 20 });
    fireEvent.click(overlay, { clientX: 70, clientY: 20 });
    fireEvent.click(overlay, { clientX: 50, clientY: 70 });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(h.createAnnotation).toHaveBeenCalledTimes(2);
    fireEvent.click(overlay, { clientX: 20, clientY: 20 });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(container.querySelectorAll(".pyramid-draft-vertex")).toHaveLength(0);
    expect(h.createAnnotation).toHaveBeenCalledTimes(2);
  });

  it("放大或缩小时仍按屏幕距离命中首点闭合", async () => {
    useSession.getState().setTool("polygon");
    const imageToScreen = vi.spyOn(h.viewer.viewport, "imageToViewerElementCoordinates")
      .mockImplementation((p) => ({ x: p.x / 10, y: p.y / 10 }));
    const screenToImage = vi.spyOn(h.viewer.viewport, "viewerElementToImageCoordinates")
      .mockImplementation((p) => ({ x: p.x * 10, y: p.y * 10 }));
    const { container } = render(<PyramidViewer {...props()} />);
    await waitFor(() => expect(h.viewer.open).toHaveBeenCalledOnce());
    const overlay = container.querySelector(".wsi-annotation-overlay")!;
    fireEvent.click(overlay, { clientX: 10, clientY: 10 });
    fireEvent.click(overlay, { clientX: 50, clientY: 10 });
    fireEvent.click(overlay, { clientX: 30, clientY: 50 });
    fireEvent.click(overlay, { clientX: 20, clientY: 10 });
    expect(h.createAnnotation).toHaveBeenCalledWith({
      image_id: "slide-1",
      primitive: { kind: "polyline", closed: true, points: [[100, 100], [500, 100], [300, 500]] },
    });
    imageToScreen.mockRestore();
    screenToImage.mockRestore();
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
    const { container } = render(<PyramidViewer {...props()} />);
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

  it("多边形顶点拖动等待保存时保持预览，重载服务端几何后位置一致", async () => {
    const original = {
      id: "saved-poly",
      image_id: "slide-1",
      primitive: { kind: "polyline" as const, closed: true as const, points: [[10, 10], [70, 10], [40, 70]] },
      label: "",
      status: "confirmed" as const,
      source: "manual" as const,
      seq: 4,
    };
    const saved = { ...original, primitive: { ...original.primitive, points: [[10, 10], [90, 15], [40, 70]] }, seq: 5 };
    useSession.setState({ tool: "cursor", annotations: [original] });
    let resolveSave!: (value: typeof saved) => void;
    h.patchAnnotation.mockReturnValue(new Promise<typeof saved>((resolve) => { resolveSave = resolve; }));
    const Harness = () => {
      const annotations = useSession((state) => state.annotations);
      return <PyramidViewer {...props()} annotations={annotations} />;
    };
    const { container, unmount } = render(<Harness />);
    await waitFor(() => expect(h.viewer.open).toHaveBeenCalledOnce());
    const secondVertex = container.querySelectorAll(".pyramid-vertex")[1];
    fireEvent.pointerDown(secondVertex, { pointerId: 1, clientX: 70, clientY: 10 });
    fireEvent.pointerMove(secondVertex, { pointerId: 1, clientX: 90, clientY: 15 });
    fireEvent.pointerUp(secondVertex, { pointerId: 1, clientX: 90, clientY: 15 });
    expect(h.patchAnnotation).toHaveBeenCalledWith("saved-poly", 4, { primitive: saved.primitive });
    expect(container.querySelectorAll(".pyramid-vertex")[1].getAttribute("cx")).toBe("90");
    await act(async () => { useSession.getState().setAnnotations([saved]); resolveSave(saved); });
    expect(container.querySelectorAll(".pyramid-vertex")[1].getAttribute("cx")).toBe("90");

    unmount();
    useSession.getState().setAnnotations([]);
    h.loadAnnotations.mockImplementation(async () => { useSession.getState().setAnnotations([saved]); });
    const reopened = render(<Harness />);
    await waitFor(() => expect(reopened.container.querySelector("polygon")?.getAttribute("points")).toBe("10,10 90,15 40,70"));
  });
});
