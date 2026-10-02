/** 图谱案例只读检索（SDD 03）。只向当前模型连接发图，归为 `read`（SDD 15 D-9）。 */
import type { HarnessTool } from "../pi/harness-registry.js";
import { CONSULT_ATLAS_TOOL_NAME, createConsultAtlasTool } from "../pi/tools/consult-atlas.js";
import type { GlauxPlugin } from "./types.js";

const ATLAS_PROMPT =
  " Glaux also keeps an Atlas: a human-curated casebook of reference images. Consult it with the " +
  "consult_atlas tool before judging what a finding or structure looks like, and cite the case ids you used.";

export const atlasPlugin: GlauxPlugin = {
  name: "atlas",
  applies: () => true,
  tools: [
    {
      name: CONSULT_ATLAS_TOOL_NAME, effect: "read", requires: { vision: true, runtime: true }, supports: () => true,
      create: (ctx) => createConsultAtlasTool({ runtime: ctx.runtime!, connection: ctx.connection!, ...(ctx.viewer ? { viewer: ctx.viewer } : {}) }) as HarnessTool,
      promptFragment: () => ATLAS_PROMPT,
    },
  ],
};
