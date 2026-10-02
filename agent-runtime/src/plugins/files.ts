/**
 * SDD 16：pi 内置的 `read` / `write` / `edit` 接入 Glaux。
 *
 * 内置工具的 `execute` 需要 `{env}` 上下文，Glaux 的 harness 不带 `toolContext`，因此由适配器把本命令的
 * 执行环境闭包进去。Glaux 在内置行为之外补充：路径范围（交给权限插件判定敏感路径）、二进制拒绝、
 * 无视觉连接的图像降级、读取卡片与写入通知的 `details`。
 */
import { open, readFile } from "node:fs/promises";
import { basename } from "node:path";

import {
  createEditTool,
  createReadTool,
  createWriteTool,
  type AgentHarnessTool,
  type AgentToolResult,
  type ExecutionEnv,
  type ExecutionToolContext,
} from "@earendil-works/pi-agent-core";

import type { HarnessTool, HarnessToolContext } from "../pi/harness-registry.js";
import { resolvePathScope } from "../workspace/path-scope.js";
import type { GlauxPlugin, PluginTool } from "./types.js";

export const FILE_READ_DETAILS_KIND = "glaux.file_read";
export const FILE_CHANGED_DETAILS_KIND = "glaux.file_changed";
export const READ_TOOL_NAME = "read";
export const WRITE_TOOL_NAME = "write";
export const EDIT_TOOL_NAME = "edit";

/** SDD 14 §9.2 的卡片字段。 */
export interface FileReadDetails {
  kind: typeof FILE_READ_DETAILS_KIND;
  path: string;
  name: string;
  start_line: number;
  end_line: number;
  eof: boolean;
  total_lines: number | null;
}

/** SDD 16 §9.2。 */
export interface FileChangedDetails {
  kind: typeof FILE_CHANGED_DETAILS_KIND;
  op: "write" | "edit";
  path: string;
  project_id?: string;
}

const SNIFF_BYTES = 8 * 1024;

/** 与 pi 内置 `read` 识别的图像格式一致：png、jpeg、gif、webp、bmp。 */
function isImage(head: Uint8Array): boolean {
  const at = (i: number, ...bytes: number[]) => bytes.every((b, k) => head[i + k] === b);
  return at(0, 0x89, 0x50, 0x4e, 0x47) || at(0, 0xff, 0xd8, 0xff) || at(0, 0x47, 0x49, 0x46, 0x38)
    || (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) || at(0, 0x42, 0x4d);
}

async function sniff(path: string): Promise<Uint8Array | undefined> {
  const handle = await open(path, "r").catch(() => undefined);
  if (!handle) return undefined;
  try {
    const buffer = new Uint8Array(SNIFF_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, SNIFF_BYTES, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** 把需要 `{env}` 的内置工具转成无上下文的 HarnessTool。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 内置工具各自的参数 schema 不同
function bindEnv(tool: AgentHarnessTool<ExecutionToolContext, any, any>, env: ExecutionEnv): HarnessTool {
  return {
    ...tool,
    execute: (id, params, signal, onUpdate) => tool.execute(id, params, signal, onUpdate, { env }),
  } as HarnessTool;
}

function pathArg(args: Record<string, unknown>): string {
  return typeof args.path === "string" ? args.path : "";
}

const pathScope: PluginTool["pathScope"] = (args, cwd) => resolvePathScope(cwd, pathArg(args));

function createRead(ctx: HarnessToolContext): HarnessTool {
  const env = ctx.execEnv!;
  const cwd = ctx.cwd!;
  const inner = bindEnv(createReadTool(), env);
  return {
    ...inner,
    async execute(id, params, signal, onUpdate) {
      const args = params as { path?: unknown; offset?: number; limit?: number };
      const scope = await resolvePathScope(cwd, typeof args.path === "string" ? args.path : "");
      const head = await sniff(scope.absolute);
      const image = head ? isImage(head) : false;
      if (head && !image && head.includes(0)) {
        throw new Error(`binary file: ${args.path} is not a text file and cannot be read with read.`);
      }
      if (image && !ctx.connection?.vision) {
        return { content: [{ type: "text", text: "image omitted: the connection has no vision." }], details: undefined };
      }
      const result = (await inner.execute(id, params, signal, onUpdate, undefined)) as AgentToolResult<unknown>;
      if (image || !ctx.projectId || scope.outside) return result;
      return { ...result, details: await readDetails(scope.absolute, scope.subject, args, result) };
    },
  };
}

/** 由 offset、limit 与内置截断信息推出卡片的行区间（SDD 16 §7.3 规则 4）。 */
async function readDetails(
  absolute: string, subject: string, args: { offset?: number; limit?: number }, result: AgentToolResult<unknown>,
): Promise<FileReadDetails> {
  const total = (await readFile(absolute, "utf8")).split("\n").length;
  const start = Math.max(1, Math.trunc(args.offset ?? 1));
  const truncation = (result.details as { truncation?: { outputLines?: number } } | undefined)?.truncation;
  let end: number;
  if (truncation?.outputLines !== undefined) end = start + truncation.outputLines - 1;
  else if (args.limit !== undefined) end = Math.min(start + Math.trunc(args.limit) - 1, total);
  else end = total;
  return { kind: FILE_READ_DETAILS_KIND, path: subject, name: basename(absolute), start_line: start, end_line: end, eof: end >= total, total_lines: total };
}

function createWriter(ctx: HarnessToolContext, op: "write" | "edit"): HarnessTool {
  const cwd = ctx.cwd!;
  const inner = bindEnv(op === "write" ? createWriteTool() : createEditTool(), ctx.execEnv!);
  return {
    ...inner,
    async execute(id, params, signal, onUpdate) {
      const result = (await inner.execute(id, params, signal, onUpdate, undefined)) as AgentToolResult<unknown>;
      const scope = await resolvePathScope(cwd, pathArg(params as Record<string, unknown>));
      const details: FileChangedDetails = {
        kind: FILE_CHANGED_DETAILS_KIND,
        op,
        path: scope.subject,
        ...(ctx.projectId && !scope.outside ? { project_id: ctx.projectId } : {}),
      };
      return { ...result, details };
    },
  };
}

function filesPrompt(ctx: HarnessToolContext): string {
  const where = ctx.projectId
    ? "the project folder"
    : "this conversation's private workspace (files there are deleted with the conversation)";
  return ` You can read and change files with read, write and edit. Relative paths resolve against ${where}: ${ctx.cwd}. ` +
    "Reading or writing outside it, or hidden paths such as .env or .git, needs the user's approval. " +
    "Read a file before editing it, and prefer edit for small changes to existing files. Text is read and written as UTF-8.";
}

export const filesPlugin: GlauxPlugin = {
  name: "files",
  applies: (ctx) => !!ctx.cwd && !!ctx.execEnv,
  promptFragment: filesPrompt,
  tools: [
    {
      name: READ_TOOL_NAME, effect: "read", pathScope, requires: {}, supports: () => true,
      create: createRead, promptFragment: () => "",
    },
    {
      name: WRITE_TOOL_NAME, effect: "write", pathScope, requires: {}, supports: () => true,
      create: (ctx) => createWriter(ctx, "write"), promptFragment: () => "",
    },
    {
      name: EDIT_TOOL_NAME, effect: "write", pathScope, requires: {}, supports: () => true,
      create: (ctx) => createWriter(ctx, "edit"), promptFragment: () => "",
    },
  ],
};
