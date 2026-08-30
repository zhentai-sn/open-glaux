// 退役 orchestration P3：智能体工具产出 → 查看器（toolBridge）与查看器上下文出站（toViewerContext）。
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TaskView } from "../api/types";

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
};

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
    z: null,
    seq: 1,
  },
};

describe("toolBridge.applyToolExecutionEvent", () => {
  beforeEach(() => localStorage.clear());

  it("applies run_task output to the viewer when it matches the active image", async () => {
    const { session, bridge } = await fresh();
    session.getState().setActiveImage("tech_401");
    expect(bridge.applyToolExecutionEvent(toolEnd(DETAILS))).toBe(true);
    const s = session.getState();
    expect(s.metrics?.IMT_mean.value).toBe(0.62);
    expect(s.primitives).toHaveLength(1);
    expect(s.source).toBe("agent");
    expect(s.modelVersion).toBe("caroSegDeep@1");
  });

  it("ignores stale results (user switched image), errors, other tools and malformed details", async () => {
    const { session, bridge } = await fresh();
    session.getState().setActiveImage("tech_999");
    expect(bridge.applyToolExecutionEvent(toolEnd(DETAILS))).toBe(false);
    session.getState().setActiveImage("tech_401");
    expect(bridge.applyToolExecutionEvent(toolEnd(DETAILS, { isError: true }))).toBe(false);
    expect(bridge.applyToolExecutionEvent(toolEnd(DETAILS, { toolName: "other" }))).toBe(false);
    expect(bridge.applyToolExecutionEvent(toolEnd({ kind: "nope" }))).toBe(false);
    expect(bridge.applyToolExecutionEvent({ type: "message_end" })).toBe(false);
    expect(session.getState().metrics).toBeNull();
  });

  it("applies propose_annotation to the current viewer immediately and idempotently", async () => {
    const { session, bridge } = await fresh();
    session.getState().setActiveImage("natural_cat");
    const event = toolEnd(PROPOSED_DETAILS, { toolName: "propose_annotation" });

    expect(bridge.applyToolExecutionEvent(event)).toBe(true);
    expect(bridge.applyToolExecutionEvent(event)).toBe(true);

    expect(session.getState().annotations).toEqual([
      {
        id: "ann-cat-1",
        image_id: "natural_cat",
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
    session.getState().setActiveImage("natural_dog");
    expect(
      bridge.applyToolExecutionEvent(
        toolEnd(PROPOSED_DETAILS, { toolName: "propose_annotation" }),
      ),
    ).toBe(false);

    session.getState().setActiveImage("natural_cat");
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

  it("applies a closed polygon proposal without retaining untrusted extra fields", async () => {
    const { session, bridge } = await fresh();
    session.getState().setActiveImage("natural_cat");
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

  it("reports the active image, task, method and cf for raster modalities", async () => {
    const { session, conv } = await fresh();
    const s = session.getState();
    s.setTasks([IMT_TASK]);
    s.setActiveImage("tech_401");
    s.setImageMeta({ id: "tech_401", center: "c", cf: 0.06, methods: [], modality: "carotid_imt" });
    expect(conv.toViewerContext()).toEqual({
      modality: "carotid_imt",
      task: "far_wall_cca_imt",
      method: "caroSegDeep",
      image_id: "tech_401",
      cubs_cf: 0.06,
    });
  });

  it("uses the slide + roi for pathology and omits image_id when nothing is open", async () => {
    const { session, conv } = await fresh();
    const s = session.getState();
    s.setModality("pathology");
    s.setActiveSlide("slide_001");
    s.setWsiRoi([1, 2, 3, 4]);
    expect(conv.toViewerContext()).toMatchObject({
      modality: "pathology",
      image_id: "slide_001",
      roi_box: [1, 2, 3, 4],
    });
    s.setActiveSlide(null);
    expect(conv.toViewerContext().image_id).toBeUndefined();
  });

  it("sends natural images without a stale medical task, method or calibration", async () => {
    const { session, conv } = await fresh();
    const s = session.getState();
    s.setTasks([IMT_TASK]);
    s.setModality("natural_image");
    s.setActiveImage("natural_cat");
    s.setImageMeta({
      id: "natural_cat",
      center: "Natural images",
      cf: null,
      methods: [],
      modality: "natural_image",
    });
    expect(conv.toViewerContext()).toEqual({
      modality: "natural_image",
      image_id: "natural_cat",
    });
  });
});
