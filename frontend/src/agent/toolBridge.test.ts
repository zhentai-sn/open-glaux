// 退役 orchestration P3：智能体工具产出 → 查看器（toolBridge）与查看器上下文出站（toViewerContext）。
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Focus, TaskView } from "../api/types";
import { objectMeta, taskFields } from "../test/fixtures";

const IMT_TASK: TaskView = {
  task: "far_wall_cca_imt",
  adapter_kind: "wall_pair",
  modality: "carotid_imt",
  label: { en: "IMT", zh: "IMT" },
  default_method: "caroSegDeep",
  viewer: "raster_2d",
  metrics: [],
  tools: [],
  overlays: [],
  capabilities: ["bbox", "polygon", "brush"],
  on_commit: null,
  ...taskFields("carotid_imt"),
};

function focusOn(
  session: { getState: () => { setFocus: (f: Focus | null) => void } },
  id: string,
  kind: Focus["kind"] = "image",
) {
  session.getState().setFocus({ object_id: id, kind, index: {}, region: null });
}

async function fresh() {
  vi.resetModules();
  const session = (await import("../store/session")).useSession;
  const bridge = await import("./toolBridge");
  const conv = await import("./useConversation");
  return { session, bridge, conv };
}

function toolEnd(details: unknown, extra: Record<string, unknown> = {}) {
  return {
    type: "tool_execution_end",
    toolCallId: "c1",
    toolName: "run_task",
    isError: false,
    result: { content: [], details },
    ...extra,
  };
}

const DETAILS = {
  kind: "glaux.task_output",
  task: "far_wall_cca_imt",
  image_id: "tech_401",
  output: {
    metrics: { IMT_mean: { value: 0.62, unit: "mm", label_en: "IMT mean", label_zh: "平均 IMT" } },
    primitives: [{ type: "polyline", id: "LI", role: "LI", points: [[0, 1]] }],
    provenance: { model_version: "caroSegDeep@1" },
  },
};

const PROPOSED_DETAILS = {
  kind: "glaux.annotation_proposed",
  payload: {
    annotation_id: "ann-cat-1",
    image_id: "natural_cat",
    label: "小猫",
    primitive: { kind: "bbox", x0: 221, y0: 220, x1: 1279, y1: 2777 },
    index: {},
    seq: 1,
  },
};

describe("toolBridge.applyToolExecutionEvent", () => {
  beforeEach(() => localStorage.clear());

  it("applies run_task output to the viewer when it matches the active image", async () => {
    const { session, bridge } = await fresh();
    focusOn(session, "tech_401");
    expect(bridge.applyToolExecutionEvent(toolEnd(DETAILS))).toBe(true);
    const s = session.getState();
    expect(s.metrics?.IMT_mean.value).toBe(0.62);
    expect(s.primitives).toHaveLength(1);
    expect(s.source).toBe("agent");
    expect(s.modelVersion).toBe("caroSegDeep@1");
  });

  it("ignores stale results (user switched image), errors, other tools and malformed details", async () => {
    const { session, bridge } = await fresh();
    focusOn(session, "tech_999");
    expect(bridge.applyToolExecutionEvent(toolEnd(DETAILS))).toBe(false);
    focusOn(session, "tech_401");
    expect(bridge.applyToolExecutionEvent(toolEnd(DETAILS, { isError: true }))).toBe(false);
    expect(bridge.applyToolExecutionEvent(toolEnd(DETAILS, { toolName: "other" }))).toBe(false);
    expect(bridge.applyToolExecutionEvent(toolEnd({ kind: "nope" }))).toBe(false);
    expect(bridge.applyToolExecutionEvent({ type: "message_end" })).toBe(false);
    expect(session.getState().metrics).toBeNull();
  });

  it("applies propose_annotation to the current viewer immediately and idempotently", async () => {
    const { session, bridge } = await fresh();
    focusOn(session, "natural_cat");
    const event = toolEnd(PROPOSED_DETAILS, { toolName: "propose_annotation" });

    expect(bridge.applyToolExecutionEvent(event)).toBe(true);
    expect(bridge.applyToolExecutionEvent(event)).toBe(true);

    expect(session.getState().annotations).toEqual([
      {
        id: "ann-cat-1",
        image_id: "natural_cat",
        index: {},
        label: "小猫",
        primitive: { kind: "bbox", x0: 221, y0: 220, x1: 1279, y1: 2777 },
        z: null,
        class_id: null,
        status: "suggested",
        source: "agent",
        seq: 1,
      },
    ]);

    session.getState().upsertAnnotation({
      ...session.getState().annotations[0]!,
      status: "confirmed",
      seq: 2,
    });
    expect(bridge.applyToolExecutionEvent(event)).toBe(true);
    expect(session.getState().annotations[0]).toMatchObject({
      id: "ann-cat-1",
      status: "confirmed",
      seq: 2,
    });
  });

  it("ignores stale, failed, empty and malformed annotation proposals", async () => {
    const { session, bridge } = await fresh();
    focusOn(session, "natural_dog");
    expect(
      bridge.applyToolExecutionEvent(
        toolEnd(PROPOSED_DETAILS, { toolName: "propose_annotation" }),
      ),
    ).toBe(false);

    focusOn(session, "natural_cat");
    expect(
      bridge.applyToolExecutionEvent(
        toolEnd(PROPOSED_DETAILS, { toolName: "propose_annotation", isError: true }),
      ),
    ).toBe(false);
    expect(
      bridge.applyToolExecutionEvent(
        toolEnd(
          { ...PROPOSED_DETAILS, payload: { ...PROPOSED_DETAILS.payload, annotation_id: null } },
          { toolName: "propose_annotation" },
        ),
      ),
    ).toBe(false);
    expect(
      bridge.applyToolExecutionEvent(
        toolEnd(
          {
            ...PROPOSED_DETAILS,
            payload: { ...PROPOSED_DETAILS.payload, primitive: { kind: "bbox", x0: "bad" } },
          },
          { toolName: "propose_annotation" },
        ),
      ),
    ).toBe(false);
    expect(session.getState().annotations).toEqual([]);
  });

  it("video 帧切换后不把旧帧建议写入当前查看器", async () => {
    const { session, bridge } = await fresh();
    focusOn(session, "vid-001", "video");
    session.getState().setIndex({ t: 11 });
    const details = {
      ...PROPOSED_DETAILS,
      payload: { ...PROPOSED_DETAILS.payload, image_id: "vid-001", index: { t: 10 } },
    };
    expect(bridge.applyToolExecutionEvent(toolEnd(details, { toolName: "propose_annotation" }))).toBe(false);
    expect(session.getState().annotations).toEqual([]);
    session.getState().setIndex({ t: 10 });
    expect(bridge.applyToolExecutionEvent(toolEnd(details, { toolName: "propose_annotation" }))).toBe(true);
    expect(session.getState().annotations[0]?.index).toEqual({ t: 10 });
  });

  it("applies a closed polygon proposal without retaining untrusted extra fields", async () => {
    const { session, bridge } = await fresh();
    focusOn(session, "natural_cat");
    const details = {
      ...PROPOSED_DETAILS,
      payload: {
        ...PROPOSED_DETAILS.payload,
        annotation_id: "ann-cat-polygon",
        primitive: {
          kind: "polyline",
          closed: true,
          points: [[10, 20], [30, 20], [20, 40]],
          role: "untrusted-extra",
        },
      },
    };

    expect(
      bridge.applyToolExecutionEvent(toolEnd(details, { toolName: "propose_annotation" })),
    ).toBe(true);
    expect(session.getState().annotations[0]?.primitive).toEqual({
      kind: "polyline",
      closed: true,
      points: [[10, 20], [30, 20], [20, 40]],
    });
  });
});

describe("toViewerContext", () => {
  beforeEach(() => localStorage.clear());

  it("只发送 collection、task、method、object、focus 五字段", async () => {
    const { session, conv } = await fresh();
    const s = session.getState();
    s.setTasks([IMT_TASK]);
    s.setModality("carotid_imt");
    session.setState({ activeModel: "caroSegDeep" });
    const obj = objectMeta({ id: "tech_401", cf: 0.06, modality: "carotid_imt" });
    s.setObjects("carotid_imt", [obj]);
    focusOn(session, "tech_401");
    expect(conv.toViewerContext()).toEqual({
      collection: "carotid_imt",
      task: "far_wall_cca_imt",
      method: "caroSegDeep",
      object: { id: "tech_401", kind: "image", axes: obj.axes, calibration: obj.calibration },
      focus: { object_id: "tech_401", kind: "image", index: {}, region: null },
    });
  });

  it("carries the box region for pathology and omits the object when nothing is open", async () => {
    const { session, conv } = await fresh();
    const s = session.getState();
    s.setTasks([
      { ...IMT_TASK, task: "nuclei_detection", modality: "pathology", ...taskFields("pathology") },
    ]);
    s.setModality("pathology");
    s.setObjects("pathology", [objectMeta({ id: "slide_001", modality: "pathology" })]);
    focusOn(session, "slide_001", "slide");
    s.setRegion({ kind: "box", x0: 1, y0: 2, x1: 3, y1: 4 });
    expect(conv.toViewerContext()).toMatchObject({
      collection: "pathology",
      object: { id: "slide_001" },
      focus: { region: { kind: "box", x0: 1, y0: 2, x1: 3, y1: 4 } },
    });
    s.setFocus(null);
    expect(conv.toViewerContext().focus).toBeUndefined();
    expect(conv.toViewerContext().object).toBeUndefined();
  });

  it("sends objects without a TaskView without a stale task, method or calibration", async () => {
    const { session, conv } = await fresh();
    const s = session.getState();
    s.setTasks([IMT_TASK]);
    s.setModality("natural_image");
    const obj = objectMeta({ id: "natural_cat", modality: "natural_image" });
    s.setObjects("natural_image", [obj]);
    focusOn(session, "natural_cat");
    expect(conv.toViewerContext()).toEqual({
      collection: "natural_image",
      object: { id: "natural_cat", kind: "image", axes: obj.axes, calibration: null },
      focus: { object_id: "natural_cat", kind: "image", index: {}, region: null },
    });
  });
});
