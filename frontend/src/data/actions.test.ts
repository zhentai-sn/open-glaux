// SDD 10 §6.2 / §6.3 / §10：三个动作——loadObjects / openObject / runTask。
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../api/client";
import type { ObjectMeta, TaskOutput, TaskView } from "../api/types";
import { TOOL_OPTIONS_DEFAULTS, activeObject, useSession } from "../store/session";
import { objectMeta, taskFields } from "../test/fixtures";
import { defaultIndex, loadObjects, openObject, runTask } from "./actions";

const INITIAL = useSession.getState();

const CAT = objectMeta({ id: "natural_cat", modality: "natural_image" });
const CT = objectMeta({
  id: "ct_001",
  modality: "ct_abdomen",
  calibration: { kind: "voxel_mm", value: [0.5, 0.5, 2], source: "nifti_header" },
});
const SLIDE = objectMeta({ id: "slide_001", modality: "pathology" });

function task(t: TaskView["task"], modality: string): TaskView {
  return {
    task: t,
    adapter_kind: "x",
    modality: modality as TaskView["modality"],
    label: { en: t, zh: t },
    default_method: "",
    viewer: "",
    metrics: [],
    tools: [],
    overlays: [],
    capabilities: [],
    on_commit: null,
    ...taskFields(modality),
  };
}

const OUT: TaskOutput = {
  task: "totalseg_liver_kidney",
  metrics: { v: { value: 1, unit: "mL", label_en: "v", label_zh: "v" } },
  primitives: [],
  calibration: { cf: 0, source: "voxel_spacing", provenance: {} },
  provenance: { model_version: "m" },
};

const LISTS: Record<string, ObjectMeta[]> = {
  natural_image: [CAT],
  ct_abdomen: [CT],
  pathology: [SLIDE],
};

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  useSession.setState(INITIAL, true);
  useSession.setState({
    tasks: [task("totalseg_liver_kidney", "ct_abdomen"), task("nuclei_detection", "pathology")],
  });
  vi.spyOn(api, "objects").mockImplementation(async (m) => LISTS[m] ?? []);
});

describe("openObject（显式 no-task 契约，D-18）", () => {
  it("无 TaskView 的对象：设焦点、清叠加与医学残留，不调 /task/run", async () => {
    const run = vi.spyOn(api, "taskRun");
    useSession.setState({
      modality: "ct_abdomen",
      objects: { ct_abdomen: [CT], natural_image: [CAT] },
      focus: { object_id: "ct_001", kind: "volume", index: { z: 3 }, region: null },
      metrics: { volume: { value: 3, unit: "mL", label_en: "Volume", label_zh: "体积" } },
      primitives: [{ kind: "bbox", id: "old", role: "old", x0: 1, y0: 2, x1: 3, y1: 4 }],
      modelVersion: "totalsegmentator_v2",
      tool: "brush",
    });
    await openObject("natural_cat");

    const s = useSession.getState();
    expect(s.modality).toBe("natural_image");
    expect(s.focus).toEqual({ object_id: "natural_cat", kind: "image", index: {}, region: null });
    expect(activeObject(s)).toEqual(CAT);
    expect(s.metrics).toBeNull();
    expect(s.primitives).toEqual([]);
    expect(s.modelVersion).toBe("");
    expect(s.tool).toBe("cursor");
    expect(s.toolOptions).toEqual(TOOL_OPTIONS_DEFAULTS);
    expect(run).not.toHaveBeenCalled();
  });

  it("未加载且未给模态的未知 id：忽略，不改焦点", async () => {
    useSession.setState({
      modality: "ct_abdomen",
      objects: { ct_abdomen: [CT] },
      focus: { object_id: "ct_001", kind: "volume", index: {}, region: null },
    });
    await openObject("natural_unknown");
    expect(useSession.getState().focus?.object_id).toBe("ct_001");
  });

  it("on_open 任务：打开即跑，入参取自对象（calibration 下发、image_id = focus）", async () => {
    const run = vi.spyOn(api, "taskRun").mockResolvedValue(OUT);
    await loadObjects("ct_abdomen");
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toEqual({
      task: "totalseg_liver_kidney",
      image_id: "ct_001",
      calibration: CT.calibration,
    });
    expect(useSession.getState().metrics).toEqual(OUT.metrics);
  });

  it("on_region 任务：打开不跑；给出选区后 runTask 带 region 下发并写入焦点", async () => {
    const run = vi.spyOn(api, "taskRun").mockResolvedValue(OUT);
    await loadObjects("pathology");
    expect(run).not.toHaveBeenCalled();
    expect(await runTask()).toBe(false); // 无选区：不发请求
    expect(run).not.toHaveBeenCalled();
    const box = { kind: "box" as const, x0: 1, y0: 2, x1: 30, y1: 40 };
    await runTask(box);
    expect(run.mock.calls[0][0]).toMatchObject({ task: "nuclei_detection", image_id: "slide_001", region: box });
    expect(useSession.getState().focus?.region).toEqual(box);
  });

  it("重复打开同一对象：焦点逐字段相等，最近使用不重复（§10）", async () => {
    await loadObjects("natural_image");
    const first = useSession.getState().focus;
    await openObject("natural_cat");
    await openObject("natural_cat");
    expect(useSession.getState().focus).toEqual(first);
    expect(useSession.getState().recentItems.filter((r) => r.id === "natural_cat")).toHaveLength(1);
    expect(useSession.getState().recentItems[0]).toMatchObject({ kind: "image", modality: "natural_image" });
  });

  it("对象所属模态未加载时按给出的模态加载后打开（最近使用的恢复路径）", async () => {
    await openObject("slide_001", "pathology");
    expect(useSession.getState().focus?.object_id).toBe("slide_001");
    expect(useSession.getState().modality).toBe("pathology");
  });
});

describe("loadObjects（§11.1 切模态即清空）", () => {
  it("切到新模态：焦点重建为该模态首个对象，缺省索引由 axes 决定", async () => {
    await loadObjects("ct_abdomen");
    await loadObjects("pathology");
    const s = useSession.getState();
    expect(s.focus).toEqual({ object_id: "slide_001", kind: "slide", index: { level: 2 }, region: null });
    expect(s.objects.pathology).toEqual([SLIDE]);
  });

  it("空模态：已加载为空（键存在），焦点为 null", async () => {
    await loadObjects("fetal_hc");
    const s = useSession.getState();
    expect(s.objects.fetal_hc).toEqual([]);
    expect(s.focus).toBeNull();
  });

  it("同一模态刷新：焦点仍在列表中则保留，索引不复位", async () => {
    await loadObjects("ct_abdomen");
    useSession.getState().setIndex({ z: 7 });
    await loadObjects("ct_abdomen");
    expect(useSession.getState().focus?.index).toEqual({ z: 7 });
  });
});

describe("defaultIndex", () => {
  it("z / t 取 0，level 取最粗层，image 为空对象", () => {
    expect(defaultIndex(CAT)).toEqual({});
    expect(defaultIndex(CT)).toEqual({ z: 0 });
    expect(defaultIndex(SLIDE)).toEqual({ level: 2 });
    expect(defaultIndex(objectMeta({ id: "v", modality: "video" as ObjectMeta["modality"] }))).toEqual({ t: 0 });
  });
});
