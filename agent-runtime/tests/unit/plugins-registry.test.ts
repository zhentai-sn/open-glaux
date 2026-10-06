/** SDD 15 §7.1、§7.3：插件登记表的启动期校验与工具 effect。 */
import { describe, expect, it } from "vitest";

import { PLUGINS, pluginTools, validatePlugins } from "../../src/plugins/registry.js";
import type { GlauxPlugin, PluginTool } from "../../src/plugins/types.js";

const tool = (name: string, effect?: string): PluginTool => ({
  name, effect: effect as PluginTool["effect"], requires: {}, supports: () => true,
  create: () => { throw new Error("not created in this test"); }, promptFragment: () => "",
});
const plugin = (name: string, tools: PluginTool[]): GlauxPlugin => ({ name, applies: () => true, tools });

describe("plugin registry", () => {
  it("rejects a tool without a valid effect", () => {
    expect(() => validatePlugins([plugin("p", [tool("t")])])).toThrow(/must declare a valid effect/u);
    expect(() => validatePlugins([plugin("p", [tool("t", "launch")])])).toThrow(/must declare a valid effect/u);
  });

  it("rejects duplicate plugin or tool names", () => {
    expect(() => validatePlugins([plugin("p", []), plugin("p", [])])).toThrow(/Duplicate plugin/u);
    expect(() => validatePlugins([plugin("a", [tool("t", "read")]), plugin("b", [tool("t", "read")])])).toThrow(/Duplicate tool/u);
  });

  it("declares the SDD 15 §7.3 effect for every built-in tool", () => {
    expect(Object.fromEntries(pluginTools(PLUGINS).map((t) => [t.name, t.effect]))).toEqual({
      ask_user: "read",
      observe_video_interval: "read",
      submit_video_answer: "read",
      run_task: "compute",
      view_current_image: "read",
      consult_atlas: "read",
      locate_roi: "compute",
      segment_region: "egress",
      propose_annotation: "annotate",
      revise_annotation: "annotate",
      list_annotations: "read",
      list_files: "read",
      open_file: "read",
      read: "read",
      write: "write",
      edit: "write",
      bash: "exec",
      agent: "delegate",
    });
  });
});
