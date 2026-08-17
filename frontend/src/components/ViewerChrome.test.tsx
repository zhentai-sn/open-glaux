// ViewerChrome 测试（SDD 04 T8）——引擎能力位过滤 + i18n 键齐备。
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { ViewerChrome } from "./ViewerChrome";
import { I18nProvider } from "../i18n";
import { en } from "../i18n/en";
import { zh } from "../i18n/zh";
import { TOOL_OPTIONS_DEFAULTS, useSession } from "../store/session";
import type { TaskView } from "../api/types";

const UNIFIED_TOOLS = [
  { id: "cursor", glyph: "▸", label: { en: "Select / Pan", zh: "选择 / 平移" } },
  { id: "bbox", glyph: "▭", label: { en: "Bounding box", zh: "框标注" } },
  { id: "polygon", glyph: "⬠", label: { en: "Polygon", zh: "多边形标注" } },
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
    viewer: modality === "pathology" ? "wsi" : modality === "ct_abdomen" ? "volume_3d" : "raster_2d",
    metrics: [],
    tools: UNIFIED_TOOLS,
    overlays: [],
    capabilities,
    on_commit: null,
  };
}

function mount(modality: TaskView["modality"], capabilities: string[]) {
  useSession.setState({
    modality,
    tasks: [makeTask(modality, capabilities)],
    tool: "cursor",
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
  useSession.setState({ annotations: [] });
});

describe("引擎能力位过滤", () => {
  it("WSI（capabilities 无 brush）不渲染画笔按钮，bbox/polygon 在", () => {
    mount("pathology", ["bbox", "polygon"]);
    expect(screen.queryByText("✎")).toBeNull();
    expect(screen.getByText("▭")).toBeTruthy();
    expect(screen.getByText("⬠")).toBeTruthy();
    expect(screen.getByText("▸")).toBeTruthy(); // cursor 恒在
    expect(screen.getByText("⟲")).toBeTruthy(); // reset 恒在
  });

  it("CT（capabilities 含 brush）渲染画笔按钮", () => {
    mount("ct_abdomen", ["bbox", "polygon", "brush"]);
    expect(screen.getByText("✎")).toBeTruthy();
  });

  it("raster_2d 三能力齐备", () => {
    mount("carotid_imt", ["bbox", "polygon", "brush"]);
    expect(screen.getByText("▭")).toBeTruthy();
    expect(screen.getByText("⬠")).toBeTruthy();
    expect(screen.getByText("✎")).toBeTruthy();
  });
});

describe("i18n 键", () => {
  it("chrome_* 键中英齐备且对齐", () => {
    const keys = [
      "chrome_hint_bbox",
      "chrome_hint_polygon",
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
