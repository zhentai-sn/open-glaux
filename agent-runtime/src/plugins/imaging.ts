/** 注册表任务执行与当前帧观看（SDD 02 §7.2、SDD 10）。 */
import { langOf, localizeTool, type Bilingual } from "../i18n/prompt-lang.js";
import type { HarnessTool } from "../pi/harness-registry.js";
import { createRunTaskTool, runTaskZh } from "../pi/tools/run-task.js";
import { createViewCurrentImageTool, VIEW_CURRENT_IMAGE_TOOL_NAME, VIEW_CURRENT_IMAGE_ZH } from "../pi/tools/view-image.js";
import { viewRegistryFor } from "../pi/tools/view-registry.js";
import type { GlauxPlugin } from "./types.js";

const VIEW_PROMPT: Bilingual = {
  en: " You are not looking at the image by default. Call view_current_image to actually see what the user has open, " +
    "before you describe it, judge it, or answer any question about what it shows. Never describe an image you have " +
    "not viewed in this conversation, and never treat the viewer context below as a description of the picture. " +
    "Look the way a person would: start from the whole image, zoom into a region when details matter, and zoom back " +
    "out to keep the context.",
  zh: "默认情况下你看不到图像。描述、判断或回答任何关于画面内容的问题之前，先调用 view_current_image 真正看到用户打开的内容。" +
    "绝不描述本次对话中没看过的图像，也绝不把下面的查看器上下文当作画面描述。" +
    "像人一样看图：先看全图，需要细节时放大到局部，再缩回全图把握整体。",
};

export const imagingPlugin: GlauxPlugin = {
  name: "imaging",
  applies: () => true,
  tools: [
    {
      name: "run_task", effect: "compute", projectScoped: true, requires: {}, supports: () => true,
      create: (ctx) => localizeTool(createRunTaskTool({ ...(ctx.viewer ? { viewer: ctx.viewer } : {}) }), langOf(ctx), runTaskZh(ctx.viewer)) as HarnessTool,
      promptFragment: () => "",
    },
    {
      name: VIEW_CURRENT_IMAGE_TOOL_NAME, effect: "read", projectScoped: true, requires: { vision: true }, supports: (focus) => !!focus,
      create: (ctx) => localizeTool(createViewCurrentImageTool({ ...(ctx.viewer ? { viewer: ctx.viewer } : {}), views: viewRegistryFor(ctx.run) }), langOf(ctx), VIEW_CURRENT_IMAGE_ZH) as HarnessTool,
      promptFragment: (ctx) => VIEW_PROMPT[langOf(ctx)],
    },
  ],
};
