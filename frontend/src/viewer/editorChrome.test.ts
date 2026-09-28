import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { DataSource, TaskView } from "../api/types";
import { useSession } from "../store/session";
import { dsFields, objectMeta, taskFields } from "../test/fixtures";
import { modeToolsFor, useEditorChrome } from "./editorChrome";

function source(modality: string, capabilities: string[]): DataSource {
  return {
    id: "test-source",
    name: "Test",
    modality,
    root: "",
    origin: "imported",
    calibration: {},
    status: "active",
    ...dsFields(modality),
    default_capabilities: capabilities,
  };
}

function task(modality: string, capabilities: string[], extra: Partial<TaskView> = {}): TaskView {
  return {
    task: "t",
    adapter_kind: "volume",
    modality,
    label: { en: "T", zh: "T" },
    default_method: "m",
    metrics: [],
    overlays: [],
    capabilities,
    actions: ["rerun"],
    ...taskFields(modality),
    ...extra,
  };
}

describe("modeToolsFor 的能力来源（SDD 04 §7.5 规则 2、3）", () => {
  it("无任务对象消费数据源默认能力位，常驻 cursor，按目录顺序", () => {
    const object = objectMeta({ id: "natural-1", modality: "natural_image" });
    const result = modeToolsFor(object, [], [source("natural_image", ["polygon", "bbox"])]);
    expect(result.task).toBeNull();
    expect(result.tools.map((tool) => tool.id)).toEqual(["cursor", "bbox", "polygon"]);
  });

  it("有任务对象仅消费 TaskView，不合并数据源默认能力位", () => {
    const object = objectMeta({ id: "ct-1", modality: "ct_abdomen" });
    const result = modeToolsFor(object, [task("ct_abdomen", ["brush"])], [source("ct_abdomen", ["bbox", "polygon"])]);
    expect(result.tools.map((tool) => tool.id)).toEqual(["cursor", "brush"]);
    expect(result.capabilities).toEqual(["brush"]);
  });

  it("工具标签键与任务无关", () => {
    const object = objectMeta({ id: "img-1", modality: "carotid_imt" });
    const result = modeToolsFor(object, [task("carotid_imt", ["bbox"], { label: { en: "IMT", zh: "IMT" } })], []);
    expect(result.tools.find((tool) => tool.id === "bbox")?.label).toBe("tl_bbox");
  });
});

describe("useEditorChrome", () => {
  beforeEach(() => {
    useSession.setState({ primitives: [], metrics: null, verification: null, tool: "cursor", datasources: [] });
  });

  function mount(modality: string, tasks: TaskView[], datasources: DataSource[] = []) {
    const object = objectMeta({ id: `${modality}-1`, modality });
    useSession.setState({
      modality,
      tasks,
      datasources,
      objects: { [modality]: [object] },
      focus: { object_id: object.id, kind: object.kind, index: {}, region: null },
    });
    return renderHook(() => useEditorChrome()).result;
  }

  it("无任务对象没有动作；视频有 t 帧轴、无窗宽窗位", () => {
    const chrome = mount("video", [], [source("video", ["bbox", "polygon", "brush"])]).current;
    expect(chrome.actions).toEqual([]);
    expect(chrome.axis.kind).toBe("t");
    expect(chrome.voi).toBe(false);
  });

  it("CT：窗宽窗位与 z 帧轴由对象推导", () => {
    const chrome = mount("ct_abdomen", [task("ct_abdomen", ["bbox"])]).current;
    expect(chrome.voi).toBe(true);
    expect(chrome.axis.kind).toBe("z");
    expect(chrome.actions.map((action) => action.id)).toEqual(["rerun"]);
  });

  it("2D 图像无视图段", () => {
    const chrome = mount("carotid_imt", [task("carotid_imt", ["bbox"])]).current;
    expect(chrome.voi).toBe(false);
    expect(chrome.axis.kind).toBe("none");
  });

  it("画笔选项只在画笔激活且启用时出现", () => {
    useSession.setState({ tool: "brush" });
    expect(mount("ct_abdomen", [task("ct_abdomen", ["brush"])]).current.brushOptions).toBe(true);
    expect(mount("ct_abdomen", [task("ct_abdomen", ["bbox"])]).current.brushOptions).toBe(false);
  });

  it("on_commit 为 run_task 的工具派生任务标签", () => {
    useSession.setState({ tool: "bbox" });
    const tv = task("pathology", ["bbox"], { on_commit: { bbox: { action: "run_task" } }, label: { en: "Nuclei", zh: "核" } });
    expect(mount("pathology", [tv]).current.commitTask).toEqual({ en: "Nuclei", zh: "核" });
    useSession.setState({ tool: "polygon" });
    expect(mount("pathology", [{ ...tv, capabilities: ["bbox", "polygon"] }]).current.commitTask).toBeNull();
  });

  it("读数按注册表顺序只列 store 里存在的度量", () => {
    const tv = task("carotid_imt", ["bbox"], {
      metrics: [
        { key: "b", unit: "mm", label: { en: "B", zh: "B" } },
        { key: "a", unit: "mm", label: { en: "A", zh: "A" } },
        { key: "missing", unit: "mm", label: { en: "M", zh: "M" } },
      ],
    });
    useSession.setState({
      metrics: {
        a: { value: 1, unit: "mm", label_en: "A", label_zh: "A" },
        b: { value: 2, unit: "mm", label_en: "B", label_zh: "B" },
      },
    });
    const chrome = mount("carotid_imt", [tv]).current;
    expect(chrome.readout.metrics.map((m) => m.label_en)).toEqual(["B", "A"]);
  });
});

describe("verification 生命周期（SDD 04 §7.5 规则 10）", () => {
  it("切换到其他对象时清空，同一对象重设焦点保留", () => {
    const s = useSession.getState();
    s.setFocus({ object_id: "slide-1", kind: "slide", index: {}, region: null });
    s.setVerification({ f1: 0.9, count_pred: 9, count_ref: 10 });
    s.setFocus({ object_id: "slide-1", kind: "slide", index: { level: 1 }, region: null });
    expect(useSession.getState().verification).not.toBeNull();
    s.setFocus({ object_id: "slide-2", kind: "slide", index: {}, region: null });
    expect(useSession.getState().verification).toBeNull();
  });
});
