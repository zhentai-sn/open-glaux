// SDD 10 W0 安全网：钉住「活动对象」的语义不变量（§7 规则 4 / 20、§11.1、§15 准出）。
// W0 以四槽字段与逐模态 select 动作写成；W3 收成 `focus` + `openObject` / `loadObjects` 后
// 只换了取值方式与动作名，断言语义未动。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { objectMeta, taskFields } from "../test/fixtures";

import { api } from "../api/client";
import type { ImageMeta, ModelInfo, Modality, TaskOutput, TaskView } from "../api/types";
import { applyToolExecutionEvent } from "../agent/toolBridge";
import { toViewerContext } from "../agent/useConversation";
import { loadObjects, openObject } from "../data/actions";
import { useSession } from "./session";

type S = ReturnType<typeof useSession.getState>;

// 「当前被观测对象的 id」——唯一焦点。
function currentObjectId(s: S = useSession.getState()): string | null {
  return s.focus?.object_id ?? null;
}

const switchModality = (m: Modality) => loadObjects(m);

const INITIAL = useSession.getState();

function meta(id: string, modality: Modality): ImageMeta {
  return objectMeta({ id, cf: modality === "carotid_imt" ? 0.06 : null, modality });
}

function task(t: TaskView["task"], modality: Modality, viewer: string): TaskView {
  return {
    task: t,
    adapter_kind: "test",
    modality,
    label: { en: t, zh: t },
    default_method: "",
    viewer,
    metrics: [],
    tools: [],
    overlays: [],
    capabilities: [],
    on_commit: null,
    ...taskFields(modality),
  };
}

const TASKS: TaskView[] = [
  task("far_wall_cca_imt", "carotid_imt", "raster_2d"),
  task("fetal_hc", "fetal_hc", "raster_2d"),
  task("totalseg_liver_kidney", "ct_abdomen", "volume_3d"),
  task("nuclei_detection", "pathology", "wsi"),
];

// 与后端 kernel.models() 现状同形：只有 IMT 与 HC 有模型，CT / 病理 / 自然图像没有。
const MODELS: ModelInfo[] = [
  { id: "caroSegDeep", pub: "", desc: "", active: true, backend: "", modality: "carotid_imt" },
  { id: "csm", pub: "", desc: "", active: true, backend: "", modality: "fetal_hc" },
];

const LISTS: Record<Modality, [string, string]> = {
  carotid_imt: ["tech_401", "tech_402"],
  fetal_hc: ["hc_001", "hc_002"],
  ct_abdomen: ["ct_001", "ct_002"],
  pathology: ["slide_001", "slide_002"],
  natural_image: ["natural_cat", "natural_dog"],
};

const metas = (m: Modality) => LISTS[m].map((id) => meta(id, m));

function taskOutput(): TaskOutput {
  return {
    task: "far_wall_cca_imt",
    metrics: { m: { value: 1, unit: "mm", label_en: "m", label_zh: "m" } },
    primitives: [],
    calibration: { cf: 1, source: "test", provenance: {} },
    provenance: { model_version: "from-select" },
  };
}

function runTaskEnd(imageId: string) {
  return {
    type: "tool_execution_end",
    toolCallId: "c1",
    toolName: "run_task",
    isError: false,
    result: {
      content: [],
      details: {
        kind: "glaux.task_output",
        task: "x",
        image_id: imageId,
        output: {
          metrics: { agent: { value: 9, unit: "mm", label_en: "a", label_zh: "a" } },
          primitives: [],
          provenance: { model_version: `agent@${imageId}` },
        },
      },
    },
  };
}

function proposeEnd(imageId: string, annotationId: string) {
  return {
    type: "tool_execution_end",
    toolCallId: "c2",
    toolName: "propose_annotation",
    isError: false,
    result: {
      content: [],
      details: {
        kind: "glaux.annotation_proposed",
        payload: {
          annotation_id: annotationId,
          image_id: imageId,
          label: "x",
          primitive: { kind: "bbox", x0: 1, y0: 1, x1: 5, y1: 5 },
          z: null,
          seq: 1,
        },
      },
    },
  };
}

/** 各模态路径：先经 loadObjects 打开首个对象，再用 openObject 换到第二个（五条路径同一动作）。 */
const PATHS: { modality: Modality; from: Modality; select: (id: string) => unknown }[] = [
  { modality: "carotid_imt", from: "fetal_hc", select: openObject },
  { modality: "fetal_hc", from: "carotid_imt", select: openObject },
  { modality: "ct_abdomen", from: "carotid_imt", select: openObject },
  { modality: "pathology", from: "carotid_imt", select: openObject },
  { modality: "natural_image", from: "carotid_imt", select: openObject },
];

beforeEach(() => {
  localStorage.clear();
  useSession.setState(INITIAL, true);
  useSession.setState({ tasks: TASKS });
  useSession.getState().setModels(MODELS);
  vi.spyOn(api, "objects").mockImplementation(async (m: Modality) => metas(m));
  vi.spyOn(api, "taskRun").mockImplementation(async () => taskOutput());
});

afterEach(() => vi.restoreAllMocks());

describe("active object ↔ agent context", () => {
  it.each(PATHS)("$modality: store 的活动对象与 toViewerContext 携带的对象 id 一致", async (p) => {
    const [a, b] = LISTS[p.modality];
    useSession.setState({ modality: p.from });

    await switchModality(p.modality);
    expect(currentObjectId()).toBe(a);
    expect(toViewerContext().image_id).toBe(a);
    expect(toViewerContext().modality).toBe(p.modality);

    await p.select(b);
    expect(currentObjectId()).toBe(b);
    expect(toViewerContext().image_id).toBe(b);
  });

  it("跨模态切换后上下文不残留上一模态的对象", async () => {
    await switchModality("ct_abdomen");
    expect(toViewerContext().image_id).toBe("ct_001");
    await switchModality("pathology");
    expect(currentObjectId()).toBe("slide_001");
    expect(toViewerContext().image_id).toBe("slide_001");
    await switchModality("carotid_imt");
    expect(currentObjectId()).toBe("tech_401");
    expect(toViewerContext().image_id).toBe("tech_401");
    expect(toViewerContext().roi_box).toBeUndefined();
  });
});

describe("tool results target the current object", () => {
  it.each(PATHS)("$modality: 切到 B 后，目标为 A 的工具结果被拒，目标为 B 的被接受", async (p) => {
    const [a, b] = LISTS[p.modality];
    useSession.setState({ modality: p.from });
    await switchModality(p.modality);
    await p.select(b);
    expect(currentObjectId()).toBe(b);
    const before = useSession.getState();

    expect(applyToolExecutionEvent(runTaskEnd(a))).toBe(false);
    expect(applyToolExecutionEvent(proposeEnd(a, "ann-a"))).toBe(false);
    const after = useSession.getState();
    expect(after.metrics).toBe(before.metrics);
    expect(after.modelVersion).toBe(before.modelVersion);
    expect(after.annotations).toEqual([]);

    expect(applyToolExecutionEvent(runTaskEnd(b))).toBe(true);
    expect(useSession.getState().modelVersion).toBe(`agent@${b}`);
    expect(applyToolExecutionEvent(proposeEnd(b, "ann-b"))).toBe(true);
    expect(useSession.getState().annotations.map((x) => x.image_id)).toEqual([b]);
  });

  it("跨模态切换后，上一模态对象的工具结果被拒", async () => {
    await switchModality("ct_abdomen");
    await switchModality("pathology");
    expect(applyToolExecutionEvent(runTaskEnd("ct_001"))).toBe(false);
    expect(applyToolExecutionEvent(runTaskEnd("tech_401"))).toBe(false);
    expect(applyToolExecutionEvent(runTaskEnd("slide_001"))).toBe(true);
  });
});

describe("activeModel does not leak across modalities", () => {
  it("切到有自己模型的模态时，activeModel 换成该模态的模型", async () => {
    await switchModality("carotid_imt");
    expect(useSession.getState().activeModel).toBe("caroSegDeep");
    await switchModality("fetal_hc");
    expect(useSession.getState().activeModel).toBe("csm");
    expect(toViewerContext().method).toBe("csm");
    await switchModality("carotid_imt");
    expect(useSession.getState().activeModel).toBe("caroSegDeep");
  });

  it("切到自然图像时，上下文不带上一模态的方法", async () => {
    await switchModality("natural_image");
    expect(toViewerContext().method).toBeUndefined();
  });

  // 回归（执行记录 F-1）：CT / 病理在 kernel.models() 里没有模型；曾经 IMT → CT 后 activeModel
  // 仍是 caroSegDeep，以 method=caroSegDeep 调 /task/run，CT 分割执行器因此报错退出。
  it.each(["ct_abdomen", "pathology"] as const)("切到无模型的模态 %s 时，activeModel 不沿用上一模态的", async (target) => {
    await switchModality(target);
    const run = vi.mocked(api.taskRun);
    const methods = run.mock.calls.map(([spec]) => spec.method);
    expect(methods).not.toContain("caroSegDeep");
    expect(toViewerContext().method).not.toBe("caroSegDeep");
    expect(useSession.getState().activeModel).not.toBe("caroSegDeep");
  });
});
