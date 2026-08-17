// store 工具态测试（SDD 04 T8）——tool/toolOptions 设置 + switchModality 复位无泄漏。
import { beforeEach, describe, expect, it, vi } from "vitest";

import { switchModality } from "../data/actions";
import { TOOL_OPTIONS_DEFAULTS, useSession } from "./session";

// switchModality 内部拉数据集/体积/slide——统一 mock 空列表，只验状态复位面。
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => [] })),
  );
  useSession.setState({
    modality: "carotid_imt",
    tool: "cursor",
    toolOptions: { brush: { ...TOOL_OPTIONS_DEFAULTS.brush }, voi: { ...TOOL_OPTIONS_DEFAULTS.voi } },
    annotations: [],
  });
});

afterEachCleanup();
function afterEachCleanup() {
  // vitest 顶层 import afterEach 放这里避免与上面 import 顺序冲突的假象——实际直接导出用
}

describe("tool / toolOptions", () => {
  it("setTool 与 setToolOptions 局部 patch 不串段", async () => {
    const { setTool, setToolOptions } = useSession.getState();
    setTool("brush");
    setToolOptions({ brush: { radius: 7 } });
    const s = useSession.getState();
    expect(s.tool).toBe("brush");
    expect(s.toolOptions.brush.radius).toBe(7);
    expect(s.toolOptions.brush.mode).toBe(TOOL_OPTIONS_DEFAULTS.brush.mode); // 未 patch 字段保持
    expect(s.toolOptions.voi).toEqual(TOOL_OPTIONS_DEFAULTS.voi); // voi 段不受影响
  });
});

describe("switchModality 复位无泄漏（三模态轮转）", () => {
  it("切模态后 tool 回 cursor、toolOptions 复位、annotations 清空", async () => {
    const rot: Array<"carotid_imt" | "ct_abdomen" | "pathology"> = ["ct_abdomen", "pathology", "carotid_imt"];
    for (const m of rot) {
      // 先污染状态：工具停在 brush、参数改过、有标注残留
      useSession.setState({
        tool: "brush",
        toolOptions: {
          brush: { mode: "paint", classId: 5, radius: 9 },
          voi: { ww: 1, wl: 2 },
        },
        annotations: [
          {
            id: "leak",
            image_id: "x",
            z: null,
            primitive: { kind: "bbox", x0: 0, y0: 0, x1: 1, y1: 1 },
            label: "",
            class_id: null,
            status: "draft",
            source: "manual",
            seq: 1,
          },
        ],
      });
      await switchModality(m);
      const s = useSession.getState();
      expect(s.modality).toBe(m);
      expect(s.tool).toBe("cursor");
      expect(s.toolOptions.brush).toEqual(TOOL_OPTIONS_DEFAULTS.brush);
      expect(s.toolOptions.voi).toEqual(TOOL_OPTIONS_DEFAULTS.voi);
      expect(s.annotations).toEqual([]);
    }
  });
});
