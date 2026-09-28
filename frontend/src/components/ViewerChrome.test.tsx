// ViewerChrome 测试（SDD 04 §7.5、§15 v1.1）——模式工具、视图段、动作段按四类模型装配。
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ViewerChrome } from "./ViewerChrome";
import { I18nProvider } from "../i18n";
import { en } from "../i18n/en";
import { zh } from "../i18n/zh";
import { TOOL_OPTIONS_DEFAULTS, useSession, type Tool } from "../store/session";
import type { DataSource, ObjectMeta, TaskAction, TaskView } from "../api/types";
import { dsFields, objectMeta, taskFields } from "../test/fixtures";

vi.mock("../data/actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../data/actions")>()),
  reRunActiveModel: vi.fn(async () => {}),
  verifyActiveObject: vi.fn(async () => {}),
}));

const TASK_OF: Record<string, string> = {
  pathology: "nuclei_detection",
  ct_abdomen: "totalseg_liver_kidney",
  carotid_imt: "far_wall_cca_imt",
  fetal_hc: "fetal_hc",
};

function makeTask(modality: string, capabilities: string[], actions: TaskAction[] = ["rerun"], extra: Partial<TaskView> = {}): TaskView {
  return {
    task: TASK_OF[modality],
    adapter_kind: "contour",
    modality,
    label: { en: `Task ${modality}`, zh: `任务 ${modality}` },
    default_method: "m",
    metrics: [],
    overlays: [],
    capabilities,
    actions,
    on_commit: null,
    ...taskFields(modality),
    ...extra,
  };
}

function source(modality: string, capabilities: string[]): DataSource {
  return {
    id: "test-source", name: modality, modality, root: "", origin: "imported", calibration: {}, status: "active",
    ...dsFields(modality), default_capabilities: capabilities,
  };
}

function mountObject(object: ObjectMeta, tasks: TaskView[], datasources: DataSource[] = [], tool: Tool = "cursor", index = {}) {
  useSession.setState({
    modality: object.modality,
    tasks,
    datasources,
    objects: { [object.modality]: [object] },
    focus: { object_id: object.id, kind: object.kind, index, region: null },
    tool,
    toolOptions: { brush: { ...TOOL_OPTIONS_DEFAULTS.brush }, voi: { ...TOOL_OPTIONS_DEFAULTS.voi } },
    primitives: [],
    loading: false,
  });
  return render(<I18nProvider><ViewerChrome /></I18nProvider>);
}

function mount(modality: string, capabilities: string[], tool: Tool = "cursor", actions: TaskAction[] = ["rerun"], extra: Partial<TaskView> = {}) {
  return mountObject(objectMeta({ id: `${modality}-test`, modality }), [makeTask(modality, capabilities, actions, extra)], [], tool);
}

beforeEach(() => {
  localStorage.setItem("glaux.lang", "en"); // 断言用英文 label，锁死语言避免默认值漂移
  useSession.setState({ annotations: [] });
});

describe("模式工具（规则 1～3）", () => {
  it("六类对象上 cursor 与 bbox 标签一致，任务不重命名工具", () => {
    for (const modality of ["pathology", "ct_abdomen", "carotid_imt", "fetal_hc"]) {
      const view = mount(modality, ["bbox", "polygon"]);
      expect(screen.getByText(en.tl_cursor)).toBeTruthy();
      expect(screen.getByText(en.tl_bbox)).toBeTruthy();
      view.unmount();
    }
    for (const modality of ["natural_image", "video"]) {
      const view = mountObject(objectMeta({ id: `${modality}-1`, modality }), [], [source(modality, ["bbox", "polygon"])]);
      expect(screen.getByText(en.tl_cursor)).toBeTruthy();
      expect(screen.getByText(en.tl_bbox)).toBeTruthy();
      view.unmount();
    }
  });

  it("未启用的工具不渲染；WSI 无画笔与壁线", () => {
    mount("pathology", ["bbox", "polygon"]);
    expect(screen.queryByText(en.tl_brush)).toBeNull();
    expect(screen.queryByText(en.tl_wall)).toBeNull();
    expect(screen.getByText(en.tl_polygon)).toBeTruthy();
  });

  it("IMT 四个模式工具齐备", () => {
    mount("carotid_imt", ["bbox", "polygon", "brush", "wall"]);
    for (const label of [en.tl_bbox, en.tl_polygon, en.tl_brush, en.tl_wall]) expect(screen.getByText(label)).toBeTruthy();
  });
});

describe("动作段（规则 5～7）", () => {
  it("无任务对象（通用图像、视频）没有任何动作按钮", () => {
    mountObject(objectMeta({ id: "natural-1", modality: "natural_image" }), [], [source("natural_image", ["bbox", "polygon"])]);
    expect(screen.queryByLabelText(en.act_rerun)).toBeNull();
    expect(screen.queryByLabelText(en.act_verify)).toBeNull();
  });

  it("有任务对象显示「重新运行」；WSI 另有「复现验证」", () => {
    mount("carotid_imt", ["bbox"]);
    expect(screen.getByLabelText(en.act_rerun)).toBeTruthy();
    expect(screen.queryByLabelText(en.act_verify)).toBeNull();
  });

  it("on_region 任务无选区时「重新运行」禁用并提示先框选", async () => {
    mount("pathology", ["bbox", "polygon"], "cursor", ["rerun", "verify"]);
    const rerun = screen.getByLabelText(en.act_rerun) as HTMLButtonElement;
    expect(rerun.disabled).toBe(true);
    expect(screen.getByText(en.act_rerun_need_region)).toBeTruthy();
    const verify = screen.getByLabelText(en.act_verify) as HTMLButtonElement;
    expect(verify.disabled).toBe(false);
    fireEvent.click(verify);
    const { verifyActiveObject } = await import("../data/actions");
    expect(verifyActiveObject).toHaveBeenCalledTimes(1);
  });

  it("有选区时「重新运行」可点，点击不改变当前模式", async () => {
    mount("pathology", ["bbox", "polygon"], "bbox", ["rerun", "verify"]);
    useSession.getState().setRegion({ kind: "box", x0: 0, y0: 0, x1: 100, y1: 100 });
    const rerun = await screen.findByLabelText(en.act_rerun) as HTMLButtonElement;
    expect(rerun.disabled).toBe(false);
    fireEvent.click(rerun);
    const { reRunActiveModel } = await import("../data/actions");
    expect(reRunActiveModel).toHaveBeenCalled();
    expect(useSession.getState().tool).toBe("bbox");
  });
});

describe("视图段（规则 4）", () => {
  it("CT：窗宽窗位与层滑块；滑块写入焦点 z", () => {
    mount("ct_abdomen", ["bbox", "polygon", "brush"]);
    expect(screen.getByTitle("WW 400 / WL 40")).toBeTruthy();
    const slider = screen.getByRole("slider", { name: en.chrome_slice });
    fireEvent.change(slider, { target: { value: "5" } });
    expect(useSession.getState().focus?.index.z).toBe(5);
    expect(screen.getByText(`${en.chrome_slice} 6/32`)).toBeTruthy();
  });

  it("视频：帧滑块与秒数，写入焦点 t；无窗宽窗位", () => {
    const object = objectMeta({ id: "vid-1", modality: "video", axes: [{ name: "x", size: 64 }, { name: "y", size: 48 }, { name: "t", size: 12, spacing: 40, unit: "ms" }] });
    mountObject(object, [], [source("video", ["bbox", "polygon", "brush"])], "cursor", { t: 0 });
    const slider = screen.getByRole("slider", { name: en.chrome_timeline });
    fireEvent.change(slider, { target: { value: "7" } });
    expect(useSession.getState().focus?.index.t).toBe(7);
    expect(screen.getByText(`${en.chrome_frame} 8/12`)).toBeTruthy();
    expect(screen.getByText("0.28 s")).toBeTruthy();
    expect(screen.queryByTitle("WW 400 / WL 40")).toBeNull();
  });

  it("2D 图像无帧轴与窗宽窗位", () => {
    mount("carotid_imt", ["bbox"]);
    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.queryByTitle("WW 400 / WL 40")).toBeNull();
  });
});

describe("绘制提示", () => {
  it("polygon 态提示逐点点击与首点闭合", () => {
    mount("carotid_imt", ["bbox", "polygon", "brush", "wall"], "polygon");
    expect(screen.getByText(en.chrome_hint_polygon)).toBeTruthy();
    expect(en.chrome_hint_polygon).toMatch(/click to add vertices/i);
    expect(en.chrome_hint_polygon).toMatch(/click the first to close/i);
  });

  it("wall 态显示壁线提示，与 polygon 不共用一条", () => {
    mount("carotid_imt", ["bbox", "polygon", "brush", "wall"], "wall");
    expect(screen.getByText(en.chrome_hint_wall)).toBeTruthy();
    expect(en.chrome_hint_wall).not.toBe(en.chrome_hint_polygon);
  });

  it("on_commit 派生提示：WSI bbox 追加「松手后运行」与任务标签", () => {
    mount("pathology", ["bbox", "polygon"], "bbox", ["rerun", "verify"], { on_commit: { bbox: { action: "run_task" } } });
    expect(screen.getByText(`${en.chrome_hint_bbox} · Runs Task pathology on release`)).toBeTruthy();
  });
});

describe("i18n 键", () => {
  it("编辑区键中英齐备", () => {
    const keys = [
      "tl_cursor", "tl_bbox", "tl_polygon", "tl_brush", "tl_wall",
      "chrome_hint_bbox", "chrome_hint_polygon", "chrome_hint_wall", "chrome_hint_run_on_commit",
      "chrome_brush_paint", "chrome_brush_erase", "chrome_brush_radius",
      "chrome_preset_abd", "chrome_preset_med", "chrome_preset_lung", "chrome_preset_bone",
      "chrome_timeline", "chrome_frame", "chrome_slice",
      "act_rerun", "act_rerun_need_region", "act_verify", "act_verifying", "readout_verify", "sc_esc_cursor",
    ] as const;
    for (const k of keys) {
      expect(en[k], `en.${k}`).toBeTruthy();
      expect(zh[k], `zh.${k}`).toBeTruthy();
    }
    expect(zh.tl_cursor).toBe("选择 / 平移");
    expect(zh.tl_bbox).toBe("框标注");
  });
});
