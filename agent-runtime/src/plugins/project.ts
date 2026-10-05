/** 项目目录浏览与打开（SDD 13 §7.3）。只对绑定项目的会话挂载；文本读取由 files 插件的 read 承担（SDD 16）。 */
import { langOf, localizeTool, type Bilingual } from "../i18n/prompt-lang.js";
import type { HarnessTool } from "../pi/harness-registry.js";
import { createListFilesTool, LIST_FILES_TOOL_NAME, LIST_FILES_ZH } from "../pi/tools/list-files.js";
import { createOpenFileTool, OPEN_FILE_TOOL_NAME, OPEN_FILE_ZH } from "../pi/tools/open-file.js";
import type { GlauxPlugin } from "./types.js";

const PROJECT_PROMPT: Bilingual = {
  en: " This conversation is bound to a project folder. Browse it with list_files: read-only, one level at a time, " +
    "with paths relative to the project root that cannot leave it. Tools that act on the current object only accept " +
    "objects from this project.",
  zh: "本次对话绑定了一个项目文件夹。用 list_files 浏览：只读，每次一层，路径相对项目根目录且不能越出项目。" +
    "作用于当前对象的工具只接受本项目中的对象。",
};

const OPEN_FILE_PROMPT: Bilingual = {
  en: " Use open_file to look at a project file yourself: it is read-only, takes a path relative to the project root, " +
    "and returns the file's metadata and first or representative frame. It does not change what the user has open " +
    "on stage. run_task and the other current-object tools still act on the user's stage, so when the user wants " +
    "such an action on a file you opened, ask them to click \"Open on stage\" on its object card first.",
  zh: "用 open_file 自己查看项目文件：只读，路径相对项目根目录，返回文件元数据以及首帧或代表帧。它不会改变用户在舞台上打开的内容。" +
    "run_task 等作用于当前对象的工具仍作用于用户舞台上的对象，所以当用户希望对你打开的文件执行这类操作时，" +
    "先请用户在该对象卡片上点击「在舞台打开」。",
};

export const projectPlugin: GlauxPlugin = {
  name: "project",
  applies: (ctx) => !!ctx.projectId,
  tools: [
    {
      name: LIST_FILES_TOOL_NAME, effect: "read", requires: { project: true }, supports: () => true,
      create: (ctx) => localizeTool(createListFilesTool({ projectId: ctx.projectId! }), langOf(ctx), LIST_FILES_ZH) as HarnessTool,
      promptFragment: (ctx) => PROJECT_PROMPT[langOf(ctx)],
    },
    {
      // 返回图像块：无视觉的模型收到的图会被静默替换成占位（参照 SDD 03 D-21），故要求 vision。
      name: OPEN_FILE_TOOL_NAME, effect: "read", requires: { project: true, vision: true }, supports: () => true,
      create: (ctx) => localizeTool(createOpenFileTool({ projectId: ctx.projectId! }), langOf(ctx), OPEN_FILE_ZH) as HarnessTool,
      promptFragment: (ctx) => OPEN_FILE_PROMPT[langOf(ctx)],
    },
  ],
};
