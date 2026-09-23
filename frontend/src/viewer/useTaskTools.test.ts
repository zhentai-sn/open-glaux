import { describe, expect, it } from "vitest";

import type { DataSource, TaskView } from "../api/types";
import { dsFields, objectMeta, taskFields } from "../test/fixtures";
import { taskToolsFor } from "./useTaskTools";

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

describe("useTaskTools 的能力来源", () => {
  it("无任务对象消费数据源默认能力位，并保留 cursor/reset", () => {
    const object = objectMeta({ id: "natural-1", modality: "natural_image" });
    const result = taskToolsFor(object, [], [source("natural_image", ["bbox", "polygon"])]);
    expect(result.task).toBeNull();
    expect(result.tools.map((tool) => tool.id)).toEqual(["cursor", "bbox", "polygon", "reset"]);
  });

  it("有任务对象仅消费 TaskView，不合并数据源默认能力位", () => {
    const object = objectMeta({ id: "ct-1", modality: "ct_abdomen" });
    const task: TaskView = {
      task: "totalseg_liver_kidney",
      adapter_kind: "volume",
      modality: "ct_abdomen",
      label: { en: "CT", zh: "CT" },
      default_method: "m",
      viewer: "volume_3d",
      metrics: [],
      tools: ["cursor", "bbox", "brush", "reset"].map((id) => ({ id, glyph: "", label: { en: id, zh: id } })),
      overlays: [],
      capabilities: ["brush"],
      ...taskFields("ct_abdomen"),
    };
    const result = taskToolsFor(object, [task], [source("ct_abdomen", ["bbox", "polygon"])]);
    expect(result.tools.map((tool) => tool.id)).toEqual(["cursor", "brush", "reset"]);
    expect(result.capabilities).toEqual(["brush"]);
  });
});
