/** 项目目录浏览、打开与文本读取（SDD 13 §7.3、SDD 14 §7.4）。只对绑定项目的会话挂载。 */
import type { HarnessTool } from "../pi/harness-registry.js";
import { createListFilesTool, LIST_FILES_TOOL_NAME } from "../pi/tools/list-files.js";
import { createOpenFileTool, OPEN_FILE_TOOL_NAME } from "../pi/tools/open-file.js";
import { createReadFileTool, READ_FILE_TOOL_NAME } from "../pi/tools/read-file.js";
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

const READ_FILE_PROMPT =
  " Use read_file to read a text file in the project (reports, notes, JSON, configs, scripts, logs): it is " +
  "read-only, takes a path relative to the project root, and returns numbered lines (line number, a tab, then the content) " +
  "in chunks of at most 400 lines. When the result says \"Continue with start_line=N\", call it again with that " +
  "start_line to read on. Files that list_files shows with candidate modality \"-\" may be text; read them with " +
  "read_file. Hidden paths and binary files are rejected. Reading a file does not change what the user has open on stage.";

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
    {
      // SDD 14 §7.4 规则 1：挂载条件同 list_files，只返回文本，不要求视觉；不接受对象 id，不经越界守卫。
      name: READ_FILE_TOOL_NAME, effect: "read", requires: { project: true }, supports: () => true,
      create: (ctx) => createReadFileTool({ projectId: ctx.projectId! }) as HarnessTool,
      promptFragment: () => READ_FILE_PROMPT,
    },
  ],
};
