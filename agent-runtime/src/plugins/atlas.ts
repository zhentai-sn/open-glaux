/** 图谱案例只读检索（SDD 03）。只向当前模型连接发图，归为 `read`（SDD 15 D-9）。 */
import { langOf, localizeTool, type Bilingual } from "../i18n/prompt-lang.js";
import type { HarnessTool } from "../pi/harness-registry.js";
import { CONSULT_ATLAS_TOOL_NAME, CONSULT_ATLAS_ZH, createConsultAtlasTool } from "../pi/tools/consult-atlas.js";
import type { GlauxPlugin } from "./types.js";

const ATLAS_PROMPT: Bilingual = {
  en: " Glaux also keeps an Atlas: a human-curated casebook of reference images. Consult it with the " +
    "consult_atlas tool before judging what a finding or structure looks like, and cite the case ids you used.",
  zh: "Glaux 还维护一个图谱：由人工策展的参考图像案例库。判断某个所见或结构是什么样子之前，先用 consult_atlas 查阅它，" +
    "并引用你用到的案例 id。",
};

export const atlasPlugin: GlauxPlugin = {
  name: "atlas",
  applies: () => true,
  tools: [
    {
      name: CONSULT_ATLAS_TOOL_NAME, effect: "read", requires: { vision: true, runtime: true }, supports: () => true,
      create: (ctx) => localizeTool(createConsultAtlasTool({ runtime: ctx.runtime!, connection: ctx.connection!, ...(ctx.viewer ? { viewer: ctx.viewer } : {}) }), langOf(ctx), CONSULT_ATLAS_ZH) as HarnessTool,
      promptFragment: (ctx) => ATLAS_PROMPT[langOf(ctx)],
    },
  ],
};
