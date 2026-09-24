// IMT 壁线形变工具的回归夹具（SDD 04 D-12/D-14）。
//
// 锁死一条 CS3D 契约：mouseDown 分发器只调 **preMouseDownCallback / postMouseDownCallback**
// （node_modules/@cornerstonejs/tools/.../eventDispatchers/mouseEventHandlers/mouseDown.js），
// 从不调 `mouseDownCallback`。抓手柄一旦挂错名字，drag 状态永不建立，后续
// mouseDrag/mouseUp 全部早退——工具静默失效，界面上表现为「按钮点得亮，图上没反应」。
// 下面第一条用例直接断言方法名，让这个坑不能再悄悄回来。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { objectMeta, taskFields } from "../test/fixtures";

import type { Types as ToolTypes } from "@cornerstonejs/tools";

import type { TaskView } from "../api/types";

// 坐标三重恒等：image px == world == canvas px，断言只关心命中与位移。
vi.mock("@cornerstonejs/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@cornerstonejs/core")>();
  return {
    ...actual,
    getRenderingEngine: () => ({ getViewport: () => ({ worldToCanvas: ([x, y]: number[]) => [x, y] }) }),
    utilities: {
      ...actual.utilities,
      imageToWorldCoords: (_id: string, [x, y]: number[]) => [x, y, 0],
      worldToImageCoords: (_id: string, [x, y]: number[]) => [x, y],
    },
  };
});

const taskMeasure = vi.fn(async (...a: unknown[]) => ({ metrics: {}, args: a }));
vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: { ...actual.api, taskMeasure: (...a: unknown[]) => taskMeasure(...a) } };
});

const { ImtWallHandleTool } = await import("./imtWallTool");
const { useSession } = await import("../store/session");

// y=100 的水平壁线，10 个点（>NUM_HANDLES=9 → 采样出 9 个手柄，含首末点）
const WALL_POINTS = Array.from({ length: 10 }, (_, i) => [i * 10, 100]);

function task(): TaskView {
  return {
    task: "far_wall_cca_imt",
    adapter_kind: "wall_pair",
    modality: "carotid_imt",
    label: { en: "IMT", zh: "IMT" },
    default_method: "caroSegDeep",
    metrics: [],
    tools: [],
    overlays: [{ role: "LI", color: "#4FB0FF", editable: true }],
    capabilities: ["bbox", "polygon", "brush", "wall"],
    on_commit: null,
    ...taskFields("carotid_imt"),
  };
}

/** CS3D 交互事件的最小替身——工具只读 detail 的这几个字段。 */
function evtAt(x: number, y: number): ToolTypes.EventTypes.InteractionEventType {
  return {
    detail: { renderingEngineId: "re", viewportId: "vp", currentPoints: { world: [x, y, 0] } },
  } as unknown as ToolTypes.EventTypes.InteractionEventType;
}

/** BaseTool 的构造签名是 (toolProps, defaultToolProps)——测试里给空对象即可。 */
const newTool = () => {
  const tool = new ImtWallHandleTool({}, {});
  tool.configuration = { objectId: "tech_401", imageId: "web:frame" };
  return tool;
};

beforeEach(() => {
  taskMeasure.mockClear();
  useSession.setState({
    modality: "carotid_imt",
    tasks: [task()],
    primitives: [{ kind: "polyline", id: "li", role: "LI", closed: false, points: WALL_POINTS.map((p) => [...p]) }],
    objects: { carotid_imt: [objectMeta({ id: "tech_401", cf: 0.05, modality: "carotid_imt" })] },
    focus: { object_id: "tech_401", kind: "image", index: {}, region: null },
  });
});

describe("ImtWallHandleTool 的分发器契约", () => {
  it("暴露 CS3D 真正会调的回调名，且不留 mouseDownCallback 这个死名字", () => {
    const tool = newTool();
    expect(typeof tool.preMouseDownCallback).toBe("function");
    expect(typeof tool.mouseDragCallback).toBe("function");
    expect(typeof tool.mouseUpCallback).toBe("function");
    expect((tool as unknown as Record<string, unknown>).mouseDownCallback).toBeUndefined();
  });

  it("只使用查看器注入的对象与帧，焦点切走不改变壁线目标", () => {
    const tool = newTool();
    useSession.setState({ focus: { object_id: "another", kind: "image", index: {}, region: null } });
    expect(tool.preMouseDownCallback(evtAt(0, 100))).toBe(true);
  });
});

describe("抓手柄 → 形变 → 重算", () => {
  it("按在手柄上返回 true（消费事件）", () => {
    const tool = newTool();
    expect(tool.preMouseDownCallback(evtAt(0, 100))).toBe(true); // 首点即手柄
  });

  it("按在远离壁线处返回 false，不吞事件", () => {
    const tool = newTool();
    expect(tool.preMouseDownCallback(evtAt(45, 10))).toBe(false);
  });

  it("无可编辑壁线（模型未产出）时返回 false 而不是抛错", () => {
    useSession.setState({ primitives: [] });
    const tool = newTool();
    expect(tool.preMouseDownCallback(evtAt(0, 100))).toBe(false);
  });

  it("拖拽把形变写回 store，抬手提交 /task/measure", async () => {
    const tool = newTool();
    expect(tool.preMouseDownCallback(evtAt(0, 100))).toBe(true);
    tool.mouseDragCallback(evtAt(0, 112));
    const moved = useSession.getState().primitives[0];
    expect(moved.kind).toBe("polyline");
    if (moved.kind !== "polyline") throw new Error("unreachable");
    expect(moved.points[0][1]).toBeCloseTo(112, 5); // 形变中心位移 = 光标位移
    expect(moved.points[9][1]).toBeLessThan(112); // 高斯衰减：远端位移更小

    await tool.mouseUpCallback();
    expect(taskMeasure).toHaveBeenCalledTimes(1);
    expect(taskMeasure.mock.calls[0][0]).toBe("far_wall_cca_imt");
    expect(useSession.getState().source).toBe("human"); // 编辑后来源翻人工
  });

  it("没抓到手柄时抬手不发测量请求", async () => {
    const tool = newTool();
    tool.preMouseDownCallback(evtAt(45, 10));
    tool.mouseDragCallback(evtAt(45, 22));
    await tool.mouseUpCallback();
    expect(taskMeasure).not.toHaveBeenCalled();
  });
});
