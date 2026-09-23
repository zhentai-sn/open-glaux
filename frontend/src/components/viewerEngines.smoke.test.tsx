// 查看器引擎冒烟测试（SDD 10 D-21 / §17 Q1）——W4 引擎合并前的接线回归网。
// 覆盖 FrameStackViewer 的 image / volume 两条真实组件路径，三步：
//   1. 渲染一帧：组件向渲染引擎挂 STACK 视口并 setStack 期望的 imageId；
//   2. 画一条多边形：store.tool=polygon 激活 PlanarFreehandROI，CS3D 的 ANNOTATION_COMPLETED
//      经 csAnno 桥落 POST /annotations，落库目标 = 焦点对象（CT 另带当前 z）；
//   3. 提交一笔画笔：overlay 自持缓冲的笔迹，2D 落 /annotations（kind=mask），CT 落 /objects/{id}/edits。
// 替身边界只在 jsdom 做不到的地方：
//   - @cornerstonejs/core：`RenderingEngine`（WebGL/vtk）与 `init` 替换；其余（utilities 坐标换算、
//     metaData、eventTarget、Enums）用真实实现；
//   - @cornerstonejs/tools：只替换 `ToolGroupManager`（真 ToolGroup.addViewport 要求引擎注册进
//     core 的引擎缓存）；工具类、annotation 状态、tools init 用真实实现；
//   - 本仓库 loader：`preloadDims`（jsdom 不解码图片）、nifti 的整卷加载；
//   - jsdom 缺口：canvas 2D 上下文、toDataURL、ResizeObserver、元素尺寸；
//   - 后端：fetch。
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Annotation, Focus, ObjectMeta, Primitive, TaskView } from "../api/types";
import { objectMeta, taskFields } from "../test/fixtures";
import { I18nProvider } from "../i18n";

// --- 替身注册表（vi.mock 工厂提升到文件顶，只能经 vi.hoisted 共享状态）-------------

const h = vi.hoisted(() => {
  type Vp = {
    id: string;
    type: string;
    element: HTMLElement;
    setStack: ReturnType<typeof vi.fn>;
    setImageIdIndex: ReturnType<typeof vi.fn>;
    setProperties: ReturnType<typeof vi.fn>;
    resetCamera: ReturnType<typeof vi.fn>;
    render: ReturnType<typeof vi.fn>;
    canvasToWorld: (p: number[]) => number[];
    worldToCanvas: (p: number[]) => number[];
    getFrameOfReferenceUID: () => string;
  };
  type FakeEngine = { id: string; viewports: Map<string, Vp>; destroyed: boolean };
  type FakeTg = {
    id: string;
    viewports: Array<{ viewportId: string; renderingEngineId?: string }>;
    tools: Set<string>;
    primary: string | null;
    active: Set<string>;
  };
  const engines: FakeEngine[] = [];
  const toolGroups = new Map<string, FakeTg>();

  class FakeRenderingEngine {
    id: string;
    viewports = new Map<string, Vp>();
    destroyed = false;
    constructor(id: string) {
      this.id = id;
      engines.push(this);
    }
    enableElement(input: { viewportId: string; type: string; element: HTMLElement }) {
      // 画布坐标 = 世界坐标（单位相机）；世界 → 图像由真实 csUtils + 元数据 provider 换算
      this.viewports.set(input.viewportId, {
        id: input.viewportId,
        type: input.type,
        element: input.element,
        setStack: vi.fn(async () => undefined),
        setImageIdIndex: vi.fn(async () => undefined),
        setProperties: vi.fn(),
        resetCamera: vi.fn(),
        render: vi.fn(),
        canvasToWorld: ([x, y]: number[]) => [x, y, 0],
        worldToCanvas: ([x, y]: number[]) => [x, y],
        getFrameOfReferenceUID: () => "GLAUX_TEST",
      });
    }
    getViewport(id: string) {
      return this.viewports.get(id);
    }
    resize() {}
    destroy() {
      this.destroyed = true;
    }
  }

  function fakeToolGroup(id: string): FakeTg & Record<string, unknown> {
    const tg = {
      id,
      viewports: [] as FakeTg["viewports"],
      tools: new Set<string>(),
      primary: null as string | null,
      active: new Set<string>(),
      addViewport(viewportId: string, renderingEngineId?: string) {
        tg.viewports.push({ viewportId, renderingEngineId });
      },
      addTool(name: string) {
        tg.tools.add(name);
      },
      setToolActive(name: string, cfg?: { bindings?: Array<{ mouseButton: number }> }) {
        tg.active.add(name);
        if (cfg?.bindings?.some((b) => b.mouseButton === 1)) tg.primary = name;
      },
      setToolPassive(name: string) {
        tg.active.delete(name);
        if (tg.primary === name) tg.primary = null;
      },
      setToolDisabled(name: string) {
        tg.active.delete(name);
        if (tg.primary === name) tg.primary = null;
      },
      setToolConfiguration() {
        return true;
      },
    };
    return tg;
  }

  return { engines, toolGroups, FakeRenderingEngine, fakeToolGroup };
});

vi.mock("@cornerstonejs/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@cornerstonejs/core")>();
  return { ...actual, init: vi.fn(async () => true), RenderingEngine: h.FakeRenderingEngine };
});

vi.mock("@cornerstonejs/tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@cornerstonejs/tools")>();
  return {
    ...actual,
    ToolGroupManager: {
      ...actual.ToolGroupManager,
      createToolGroup: (id: string) => {
        if (h.toolGroups.has(id)) return undefined; // 同真实实现：id 重复返回 undefined
        const tg = h.fakeToolGroup(id);
        h.toolGroups.set(id, tg);
        return tg;
      },
      destroyToolGroup: (id: string) => {
        h.toolGroups.delete(id);
      },
      getToolGroup: (id: string) => h.toolGroups.get(id),
    },
  };
});

vi.mock("../viewer/cornerstone", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../viewer/cornerstone")>();
  return { ...actual, preloadDims: vi.fn(async () => ({ rows: 64, columns: 64 })) };
});

const CT_DIMS = { columns: 16, rows: 16, slices: 8 };
const LABEL_Z = 5; // 标签体素所在层：FrameStackViewer 应自动跳到器官体素最多的 z

vi.mock("../viewer/nifti", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../viewer/nifti")>();
  const makeVol = () => {
    const raw = new Int32Array(CT_DIMS.columns * CT_DIMS.rows * CT_DIMS.slices);
    raw[LABEL_Z * CT_DIMS.columns * CT_DIMS.rows + 3] = 1;
    return { ...CT_DIMS, raw, display: new Uint16Array(raw.length), slope: 1, intercept: 0, min: 0, max: 1 };
  };
  return {
    ...actual,
    preloadNiftiDims: vi.fn(async () => ({ rows: CT_DIMS.rows, columns: CT_DIMS.columns, slices: CT_DIMS.slices })),
    loadNiftiVolume: vi.fn(async () => makeVol()),
    invalidateNiftiVolume: vi.fn(),
  };
});

const { eventTarget } = await import("@cornerstonejs/core");
const { Enums: ToolEnums, PlanarFreehandROITool } = await import("@cornerstonejs/tools");
const { invalidateNiftiVolume } = await import("../viewer/nifti");
const { Viewer } = await import("./Viewer");
const { useSession } = await import("../store/session");
const { _resetEditSeqForTest } = await import("../annotation/bridge");

// --- jsdom 缺口 -------------------------------------------------------------

/** 2D 上下文替身：绘制调用全为空操作，像素缓冲按尺寸分配（组件会逐像素写 ImageData）。 */
function fakeCtx(): CanvasRenderingContext2D {
  const imageData = (w: number, hh: number) => ({ width: w, height: hh, data: new Uint8ClampedArray(w * hh * 4) });
  const target: Record<string | symbol, unknown> = {
    createImageData: imageData,
    getImageData: (_x: number, _y: number, w: number, hh: number) => imageData(w, hh),
  };
  return new Proxy(target, {
    get: (t, k) => (k in t ? t[k] : () => undefined),
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
}

const PNG_STUB = "data:image/png;base64,STUB";

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// --- 后端替身 ---------------------------------------------------------------

type Call = { method: string; url: string; body: Record<string, unknown> | null };
let calls: Call[] = [];
let srvId = 0;

function stubBackend() {
  calls = [];
  srvId = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      calls.push({ method, url, body });
      let json: unknown = {};
      if (method === "GET" && url.startsWith("/api/annotations")) json = { annotations: [] };
      else if (method === "POST" && url === "/api/annotations") {
        const input = body as { image_id: string; z?: number | null; primitive: Annotation["primitive"] };
        const annotation: Annotation = {
          id: `srv-${++srvId}`,
          image_id: input.image_id,
          z: input.z ?? null,
          primitive: input.primitive,
          label: "",
          class_id: null,
          status: "draft",
          source: "manual",
          seq: 1,
        };
        json = { annotation, hook_result: null };
      } else if (method === "POST" && /\/objects\/[^/]+\/edits$/.test(url)) json = { metrics: {}, labelmap_ref: "x", seq: 7 };
      return { ok: true, status: 200, json: async () => json };
    }),
  );
}

const posts = (pred: (url: string) => boolean) => calls.filter((c) => c.method === "POST" && pred(c.url));

// --- 场景装配 ---------------------------------------------------------------

function task(modality: string, viewer: string): TaskView {
  return {
    task: modality === "ct_abdomen" ? "totalseg_liver_kidney" : "far_wall_cca_imt",
    default_method: "test-model",
    modality,
    viewer,
    capabilities: ["bbox", "polygon", "brush", ...(modality === "ct_abdomen" ? ["voi"] : [])],
    overlays: [],
    ...taskFields(modality),
  } as unknown as TaskView;
}

/** W3：引擎从 props 收当前对象与焦点（Viewer.tsx 是唯一读 store 处）；桥的落库目标读 store 焦点。 */
function focusOn(object: ObjectMeta): Focus {
  const focus: Focus = { object_id: object.id, kind: object.kind, index: {}, region: null };
  useSession.setState({ objects: { [object.modality]: [object] }, focus });
  return focus;
}

const LABEL_REF = "/api/labelmap/ct_1";
const VOL_PRIM = {
  kind: "volume_mask",
  id: "vm1",
  ref: LABEL_REF,
  classes: [{ class_id: 2, color: "#ff0000", label: { zh: "肝", en: "liver" } }],
} as unknown as Primitive;

const initial = useSession.getState();

beforeEach(() => {
  h.engines.length = 0;
  h.toolGroups.clear();
  _resetEditSeqForTest();
  stubBackend();
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    fakeCtx as unknown as HTMLCanvasElement["getContext"],
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(PNG_STUB);
  // 非零尺寸：组件载图前会等容器有宽度（最多 30 帧）
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(512);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(512);
  useSession.setState(initial, true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function engine(id: string) {
  const e = h.engines.find((x) => x.id === id);
  if (!e) throw new Error(`engine ${id} 未创建`);
  return e;
}

function completePolygon(referencedImageId: string, uid: string) {
  const annotation = {
    annotationUID: uid,
    metadata: { toolName: PlanarFreehandROITool.toolName, referencedImageId },
    data: {
      contour: {
        polyline: [
          [10, 10, 0],
          [30, 10, 0],
          [30, 30, 0],
        ],
        closed: true,
      },
    },
  };
  act(() => {
    eventTarget.dispatchEvent(
      new CustomEvent(ToolEnums.Events.ANNOTATION_COMPLETED as unknown as string, { detail: { annotation } }),
    );
  });
}

function brushStroke(container: HTMLElement) {
  const overlay = container.querySelector("canvas");
  if (!overlay) throw new Error("overlay canvas 缺失");
  fireEvent.pointerDown(overlay, { clientX: 8, clientY: 8, pointerId: 1 });
  fireEvent.pointerMove(overlay, { clientX: 9, clientY: 8, pointerId: 1 });
  fireEvent.pointerUp(overlay, { clientX: 9, clientY: 8, pointerId: 1 });
}

// --- raster_2d --------------------------------------------------------------

describe("FrameStackViewer（image）接线冒烟", () => {
  const IMAGE_ID = "web:/api/objects/img_1/frame?size=4096";

  async function mount2d() {
    useSession.setState({ modality: "carotid_imt", tasks: [task("carotid_imt", "raster_2d")] });
    const object = objectMeta({ id: "img_1", modality: "carotid_imt" });
    focusOn(object);
    const r = render(<I18nProvider><Viewer /></I18nProvider>);
    await waitFor(() => expect(engine("glaux-re").viewports.get("glaux-stack")?.setStack).toHaveBeenCalled());
    return r;
  }

  it("渲染一帧：STACK 视口 setStack 当前图像 + 拉该图标注", async () => {
    await mount2d();
    const vp = engine("glaux-re").viewports.get("glaux-stack")!;
    expect(vp.type).toBe("stack");
    expect(vp.setStack).toHaveBeenCalledWith([IMAGE_ID]);
    expect(vp.resetCamera).toHaveBeenCalled();
    expect(vp.render).toHaveBeenCalled();
    expect(h.toolGroups.get("glaux-tg-raster2d")?.viewports).toEqual([
      { viewportId: "glaux-stack", renderingEngineId: "glaux-re" },
    ]);
    await waitFor(() => expect(calls.some((c) => c.url === "/api/annotations?image_id=img_1")).toBe(true));
  });

  it("画一条多边形：激活 PlanarFreehandROI，完成事件落 /annotations（目标 = 焦点对象）", async () => {
    await mount2d();
    act(() => useSession.getState().setTool("polygon"));
    expect(h.toolGroups.get("glaux-tg-raster2d")?.primary).toBe(PlanarFreehandROITool.toolName);

    completePolygon(IMAGE_ID, "cs-2d-1");
    await waitFor(() => expect(posts((u) => u === "/api/annotations")).toHaveLength(1));
    const body = posts((u) => u === "/api/annotations")[0].body!;
    expect(body.image_id).toBe("img_1");
    expect(body).not.toHaveProperty("z");
    expect(body.primitive).toMatchObject({ kind: "polyline", closed: true });
    expect((body.primitive as { points: number[][] }).points).toHaveLength(3);
    await waitFor(() => expect(useSession.getState().annotations.map((a) => a.id)).toEqual(["srv-1"]));

    // 其他对象的完成事件不串到当前图（referencedImageId 作用域过滤）
    completePolygon("web:/api/image/other", "cs-2d-2");
    await Promise.resolve();
    expect(posts((u) => u === "/api/annotations")).toHaveLength(1);
  });

  it("提交一笔画笔：自持缓冲 → /annotations kind=mask（不走对象编辑）", async () => {
    const { container } = await mount2d();
    act(() => {
      useSession.getState().setToolOptions({ brush: { mode: "paint", radius: 2 } });
      useSession.getState().setTool("brush");
    });
    // brush 不激活 CS3D BrushTool：左键回退平移，指针由 overlay 接管
    expect(h.toolGroups.get("glaux-tg-raster2d")?.primary).toBe("Pan");
    brushStroke(container);

    await waitFor(() => expect(posts((u) => u === "/api/annotations")).toHaveLength(1));
    const body = posts((u) => u === "/api/annotations")[0].body!;
    expect(body).toMatchObject({ image_id: "img_1", primitive: { kind: "mask" }, mask_png_b64: PNG_STUB });
    expect(posts((u) => u.endsWith("/edits"))).toHaveLength(0);
  });
});

// --- volume_3d（CT）---------------------------------------------------------

describe("FrameStackViewer（volume）接线冒烟", () => {
  const BASE = "nifti:/api/objects/ct_1/raw";

  async function mountCt() {
    useSession.setState({ modality: "ct_abdomen", tasks: [task("ct_abdomen", "volume_3d")] });
    const object = objectMeta({ id: "ct_1", modality: "ct_abdomen", resources: { frame: "/objects/ct_1/frame", raw: "/objects/ct_1/raw" } });
    focusOn(object);
    const r = render(<I18nProvider><Viewer /></I18nProvider>);
    const vp = () => engine("glaux-re-vol").viewports.get("glaux-stack-vol");
    await waitFor(() => expect(vp()?.setImageIdIndex).toHaveBeenCalledWith(CT_DIMS.slices / 2));
    // 分割结果回流（primitives 带 volume_mask）→ 拉 labelmap → 自动跳到有器官体素的层。
    act(() => useSession.getState().setPrimitives([VOL_PRIM]));
    await waitFor(() => expect(vp()!.setImageIdIndex).toHaveBeenLastCalledWith(LABEL_Z));
    return { ...r, vp: vp()! };
  }

  it("渲染一帧：每层一个 nifti imageId，初始停在中间层，再跳到标签层并贴 VOI", async () => {
    const { vp } = await mountCt();
    expect(vp.type).toBe("stack");
    const ids = Array.from({ length: CT_DIMS.slices }, (_, i) => `${BASE}#z=${i}`);
    expect(vp.setStack).toHaveBeenCalledWith(ids, CT_DIMS.slices / 2);
    expect(vp.setProperties).toHaveBeenCalledWith({ voiRange: { lower: 40 - 200, upper: 40 + 200 } });
    expect(h.toolGroups.get("glaux-tg-vol")?.viewports).toEqual([
      { viewportId: "glaux-stack-vol", renderingEngineId: "glaux-re-vol" },
    ]);
    await waitFor(() => expect(calls.some((c) => c.url === `/api/annotations?image_id=ct_1&z=${LABEL_Z}`)).toBe(true));
  });

  it("labelmap 在挂载前已有时，初始层定位不会被体数据加载覆盖（F-3）", async () => {
    useSession.setState({ modality: "ct_abdomen", tasks: [task("ct_abdomen", "volume_3d")], primitives: [VOL_PRIM] });
    const object = objectMeta({ id: "ct_1", modality: "ct_abdomen", resources: { frame: "/objects/ct_1/frame", raw: "/objects/ct_1/raw" } });
    focusOn(object);
    render(<I18nProvider><Viewer /></I18nProvider>);
    const viewport = () => engine("glaux-re-vol").viewports.get("glaux-stack-vol");
    await waitFor(() => expect(viewport()?.setStack).toHaveBeenCalled());
    await waitFor(() => expect(viewport()?.setImageIdIndex).toHaveBeenLastCalledWith(LABEL_Z));
    expect(useSession.getState().focus?.index.z).toBe(LABEL_Z);
  });

  it("画一条多边形：完成事件落 /annotations（目标 = volume id + 当前 z）", async () => {
    await mountCt();
    act(() => useSession.getState().setTool("polygon"));
    expect(h.toolGroups.get("glaux-tg-vol")?.primary).toBe(PlanarFreehandROITool.toolName);
    // volume_3d 滚轮留给切 z：Zoom 不绑滚轮
    expect(h.toolGroups.get("glaux-tg-vol")?.active.has("Zoom")).toBe(false);

    completePolygon(`${BASE}#z=${LABEL_Z}`, "cs-ct-1");
    await waitFor(() => expect(posts((u) => u === "/api/annotations")).toHaveLength(1));
    const body = posts((u) => u === "/api/annotations")[0].body!;
    expect(body).toMatchObject({ image_id: "ct_1", z: LABEL_Z, primitive: { kind: "polyline", closed: true } });

    // 别的层的完成事件不落当前层
    completePolygon(`${BASE}#z=0`, "cs-ct-2");
    await Promise.resolve();
    expect(posts((u) => u === "/api/annotations")).toHaveLength(1);
  });

  it("提交一笔画笔：自持缓冲 → 对象编辑（D-13，不落 /annotations），成功后失效并重拉 labelmap", async () => {
    const { container } = await mountCt();
    act(() => {
      useSession.getState().setToolOptions({ brush: { mode: "paint", classId: 2, radius: 2 } });
      useSession.getState().setTool("brush");
    });
    brushStroke(container);

    await waitFor(() => expect(posts((u) => u.endsWith("/edits"))).toHaveLength(1));
    const call = posts((u) => u.endsWith("/edits"))[0];
    expect(call.url).toBe("/api/objects/ct_1/edits");
    expect(call.body).toMatchObject({
      task: "totalseg_liver_kidney",
      method: "test-model",
      base_seq: 0,
      ops: [{ index: { z: LABEL_Z }, class_id: 2, mode: "paint", mask_png: PNG_STUB }],
    });
    await waitFor(() => expect(invalidateNiftiVolume).toHaveBeenCalledWith(LABEL_REF));
    expect(posts((u) => u === "/api/annotations")).toHaveLength(0);
  });
});
