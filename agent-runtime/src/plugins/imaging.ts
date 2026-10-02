/** 注册表任务执行与当前帧观看（SDD 02 §7.2、SDD 10）。 */
import type { HarnessTool } from "../pi/harness-registry.js";
import { createRunTaskTool } from "../pi/tools/run-task.js";
import { createViewCurrentImageTool, VIEW_CURRENT_IMAGE_TOOL_NAME } from "../pi/tools/view-image.js";
import type { GlauxPlugin } from "./types.js";

const VIEW_PROMPT =
  " You are not looking at the image by default. Call view_current_image to actually see what the user has open, " +
  "before you describe it, judge it, or answer any question about what it shows. Never describe an image you have " +
  "not viewed in this conversation, and never treat the viewer context below as a description of the picture.";

export const imagingPlugin: GlauxPlugin = {
  name: "imaging",
  applies: () => true,
  tools: [
    {
      name: "run_task", effect: "compute", projectScoped: true, requires: {}, supports: () => true,
      create: (ctx) => createRunTaskTool({ ...(ctx.viewer ? { viewer: ctx.viewer } : {}) }) as HarnessTool,
      promptFragment: () => "",
    },
    {
      name: VIEW_CURRENT_IMAGE_TOOL_NAME, effect: "read", projectScoped: true, requires: { vision: true }, supports: (focus) => !!focus,
      create: (ctx) => createViewCurrentImageTool({ ...(ctx.viewer ? { viewer: ctx.viewer } : {}) }) as HarnessTool,
      promptFragment: () => VIEW_PROMPT,
    },
  ],
};
