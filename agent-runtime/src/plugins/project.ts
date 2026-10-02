/** 项目目录浏览与打开（SDD 13 §7.3）。只对绑定项目的会话挂载；文本读取由 files 插件的 read 承担（SDD 16）。 */
import type { HarnessTool } from "../pi/harness-registry.js";
import { createListFilesTool, LIST_FILES_TOOL_NAME } from "../pi/tools/list-files.js";
import { createOpenFileTool, OPEN_FILE_TOOL_NAME } from "../pi/tools/open-file.js";
import type { GlauxPlugin } from "./types.js";

const PROJECT_PROMPT =
  " This conversation is bound to a project folder. Browse it with list_files: read-only, one level at a time, " +
  "with paths relative to the project root that cannot leave it. Tools that act on the current object only accept " +
  "objects from this project.";

const OPEN_FILE_PROMPT =
  " Use open_file to look at a project file yourself: it is read-only, takes a path relative to the project root, " +
  "and returns the file's metadata and first or representative frame. It does not change what the user has open " +
  "on stage. run_task and the other current-object tools still act on the user's stage, so when the user wants " +
  "such an action on a file you opened, ask them to click \"Open on stage\" on its object card first.";

export const projectPlugin: GlauxPlugin = {
  name: "project",
  applies: (ctx) => !!ctx.projectId,
  tools: [
    {
      name: LIST_FILES_TOOL_NAME, effect: "read", requires: { project: true }, supports: () => true,
      create: (ctx) => createListFilesTool({ projectId: ctx.projectId! }) as HarnessTool,
      promptFragment: () => PROJECT_PROMPT,
    },
    {
      // 返回图像块：无视觉的模型收到的图会被静默替换成占位（参照 SDD 03 D-21），故要求 vision。
      name: OPEN_FILE_TOOL_NAME, effect: "read", requires: { project: true, vision: true }, supports: () => true,
      create: (ctx) => createOpenFileTool({ projectId: ctx.projectId! }) as HarnessTool,
      promptFragment: () => OPEN_FILE_PROMPT,
    },
  ],
};
