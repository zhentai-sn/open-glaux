// ViewerChrome 测试（SDD 04 T8）——引擎能力位过滤 + i18n 键齐备。
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { ViewerChrome } from "./ViewerChrome";
import { I18nProvider } from "../i18n";
import { en } from "../i18n/en";
import { zh } from "../i18n/zh";
import { TOOL_OPTIONS_DEFAULTS, useSession, type Tool } from "../store/session";
import type { TaskView } from "../api/types";
import { dsFields, objectMeta, taskFields } from "../test/fixtures";

const UNIFIED_TOOLS = [
  { id: "cursor", glyph: "▸", label: { en: "Select / Pan", zh: "选择 / 平移" } },
  { id: "bbox", glyph: "▭", label: { en: "Bounding box", zh: "框标注" } },
  { id: "polygon", glyph: "⬠", label: { en: "Polygon", zh: "多边形标注" } },
  { id: "wall", glyph: "≈", label: { en: "Wall edit", zh: "壁线编辑" } },
  { id: "brush", glyph: "✎", label: { en: "Brush", zh: "画笔" } },
  { id: "reset", glyph: "⟲", label: { en: "Reset to model", zh: "重置为模型输出" } },
];

function makeTask(modality: TaskView["modality"], capabilities: string[]): TaskView {
  return {
    task: modality === "pathology" ? "nuclei_detection" : modality === "ct_abdomen" ? "totalseg_liver_kidney" : "far_wall_cca_imt",
    adapter_kind: "contour",
    modality,
    label: { en: "T", zh: "T" },
    default_method: "m",
    metrics: [],
    tools: UNIFIED_TOOLS,
    overlays: [],
    capabilities,
    on_commit: null,
    ...taskFields(modality),
  };
}

function mount(modality: TaskView["modality"], capabilities: string[], tool: Tool = "cursor") {
  const object = objectMeta({ id: `${modality}-test`, modality });
  useSession.setState({
    modality,
    tasks: [makeTask(modality, capabilities)],
    objects: { [modality]: [object] },
    focus: { object_id: object.id, kind: object.kind, index: {}, region: null },
    tool,
    toolOptions: { brush: { ...TOOL_OPTIONS_DEFAULTS.brush }, voi: { ...TOOL_OPTIONS_DEFAULTS.voi } },
    primitives: [],
  });
  return render(
    <I18nProvider>
      <ViewerChrome onTool={() => {}} />
    </I18nProvider>,
  );
}

beforeEach(() => {
  localStorage.setItem("glaux.lang", "en"); // 断言用英文 label，锁死语言避免默认值漂移
  useSession.setState({ annotations: [] });
});

// 按钮内容 = lucide 图标（SDD 06）+ .tip 文案（注册表 label，SDD 04）；
// 断言走文案，不再断言 glyph 字符——字符渲染已随 SDD 06 退役。
describe("引擎能力位过滤", () => {
  it("视频时间轴只在能力位声明时出现，并写入焦点 t", () => {
    const object = objectMeta({ id: "vid-1", modality: "video", axes: [{ name: "x", size: 64 }, { name: "y", size: 48 }, { name: "t", size: 12, spacing: 40, unit: "ms" }] });
    const source = { id: object.source_id, name: "Video", modality: "video", root: "", origin: "imported" as const, calibration: {}, status: "active" as const, ...dsFields("video") };
    useSession.setState({ modality: "video", tasks: [], objects: { video: [object] }, focus: { object_id: object.id, kind: "video", index: { t: 0 }, region: null }, datasources: [{ ...source, default_capabilities: ["bbox", "polygon", "timeline", "brush"] }] });
    const view = render(<I18nProvider><ViewerChrome onTool={() => {}} /></I18nProvider>);
    const slider = screen.getByRole("slider", { name: "Timeline" });
    fireEvent.change(slider, { target: { value: "7" } });
    expect(useSession.getState().focus?.index.t).toBe(7);
    expect(screen.getByText("Frame 8/12")).toBeTruthy();
    view.unmount();

    useSession.setState({ datasources: [{ ...source, default_capabilities: ["bbox", "polygon", "brush"] }] });
    render(<I18nProvider><ViewerChrome onTool={() => {}} /></I18nProvider>);
    expect(screen.queryByRole("slider", { name: "Timeline" })).toBeNull();
  });

  it("无 TaskView 时显示数据源默认标注工具", () => {
    const object = objectMeta({ id: "natural-1", modality: "natural_image" });
    useSession.setState({
      modality: "natural_image",
      tasks: [],
      objects: { natural_image: [object] },
      focus: { object_id: object.id, kind: object.kind, index: {}, region: null },
      datasources: [{
        id: object.source_id,
        name: "Natural",
        modality: "natural_image",
        root: "",
        origin: "imported",
        calibration: {},
        status: "active",
        ...dsFields("natural_image"),
        default_capabilities: ["bbox", "polygon"],
      }],
    });
    render(<I18nProvider><ViewerChrome onTool={() => {}} /></I18nProvider>);
    expect(screen.getByText("Bounding box")).toBeTruthy();
    expect(screen.getByText("Polygon")).toBeTruthy();
    expect(screen.queryByText("Brush")).toBeNull();
  });

  it("WSI（capabilities 无 brush/wall）不渲染画笔与壁线按钮，bbox/polygon 在", () => {
    mount("pathology", ["bbox", "polygon"]);
    expect(screen.queryByText("Brush")).toBeNull();
    expect(screen.queryByText("Wall edit")).toBeNull();
    expect(screen.getByText("Bounding box")).toBeTruthy();
    expect(screen.getByText("Polygon")).toBeTruthy();
    expect(screen.getByText("Select / Pan")).toBeTruthy(); // cursor 恒在
    expect(screen.getByText("Reset to model")).toBeTruthy(); // reset 恒在
  });

  it("CT（capabilities 含 brush）渲染画笔按钮", () => {
    mount("ct_abdomen", ["bbox", "polygon", "brush"]);
    expect(screen.getByText("Brush")).toBeTruthy();
  });

  it("VOI 选项只由能力位决定", () => {
    const withVoi = mount("ct_abdomen", ["bbox", "voi"]);
    expect(screen.getByTitle("WW 400 / WL 40")).toBeTruthy();
    withVoi.unmount();
    mount("ct_abdomen", ["bbox"]);
    expect(screen.queryByTitle("WW 400 / WL 40")).toBeNull();
  });

  it("raster_2d 四能力齐备（IMT 含壁线编辑）", () => {
    mount("carotid_imt", ["bbox", "polygon", "brush", "wall"]);
    expect(screen.getByText("Bounding box")).toBeTruthy();
    expect(screen.getByText("Polygon")).toBeTruthy();
    expect(screen.getByText("Brush")).toBeTruthy();
    expect(screen.getByText("Wall edit")).toBeTruthy();
  });
});

// 提示必须与直线 SplineROI 和 WSI SVG 的逐点绘制交互一致。
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
});

describe("i18n 键", () => {
  it("chrome_* 键中英齐备且对齐", () => {
    const keys = [
      "chrome_hint_bbox",
      "chrome_hint_polygon",
      "chrome_hint_wall",
      "chrome_brush_paint",
      "chrome_brush_erase",
      "chrome_brush_radius",
      "chrome_preset_abd",
      "chrome_preset_med",
      "chrome_preset_lung",
      "chrome_preset_bone",
    ] as const;
    for (const k of keys) {
      expect(en[k], `en.${k}`).toBeTruthy();
      expect(zh[k], `zh.${k}`).toBeTruthy();
    }
  });
});
