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
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
  type AgentHarnessTool,
  type AgentToolResult,
  type ExecutionEnv,
  type ExecutionToolContext,
} from "@earendil-works/pi-agent-core";

import { langOf, schemaFor, type Bilingual, type PromptLang } from "../i18n/prompt-lang.js";
import type { HarnessTool, HarnessToolContext } from "../pi/harness-registry.js";
import { READONLY_COMMANDS, readOnlyViolation } from "../permission/readonly-command.js";
import { resolvePathScope } from "../workspace/path-scope.js";
import { buildShellEnv } from "../workspace/shell-env.js";
import type { GlauxPlugin, PluginTool } from "./types.js";

export const FILE_READ_DETAILS_KIND = "glaux.file_read";
export const FILE_CHANGED_DETAILS_KIND = "glaux.file_changed";
export const READ_TOOL_NAME = "read";
export const WRITE_TOOL_NAME = "write";
export const EDIT_TOOL_NAME = "edit";
export const BASH_TOOL_NAME = "bash";

/** SDD 16 §7.5 规则 3（D-7）。 */
export const BASH_DEFAULT_TIMEOUT_S = 120;
export const BASH_MAX_TIMEOUT_S = 600;

/** 缺省取 120 秒；超过 600 秒截到 600，并返回是否截过。 */
export function normalizeBashTimeout(timeout: unknown): { timeout: number; clamped: boolean } {
  if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0) return { timeout: BASH_DEFAULT_TIMEOUT_S, clamped: false };
  return timeout > BASH_MAX_TIMEOUT_S ? { timeout: BASH_MAX_TIMEOUT_S, clamped: true } : { timeout, clamped: false };
}

/** `bash` 规则按命令前缀匹配（SDD 16 §7.5 规则 5、D-8）。 */
export function bashPrefixMatch(pattern: string, subject: string): boolean {
  const prefix = pattern.trim();
  return prefix.length > 0 && subject.trim().startsWith(prefix);
}

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

/**
 * pi 内置工具的中文说明（SDD 20 §7.3 规则 2）。英文沿用 pi 原文；截断上限与 pi 的
 * `DEFAULT_MAX_LINES`（2000 行）、`DEFAULT_MAX_BYTES`（50KB）一致，二者未从包入口导出。
 */
interface BuiltinZh { description: string; parameters: Readonly<Record<string, string>> }
export const BUILTIN_ZH: Record<"read" | "write" | "edit" | "bash", BuiltinZh> = {
  read: {
    description: "读取文件内容。支持文本文件与图像（jpg、png、gif、webp、bmp），图像作为附件发送。文本文件的输出截断到 2000 行或 50KB（先到为准）。大文件用 offset/limit 分段读；需要全文时，用 offset 继续读到结束。",
    parameters: {
      path: "要读取的文件路径（相对或绝对）",
      offset: "起始行号（从 1 开始）",
      limit: "最多读取的行数",
    },
  },
  write: {
    description: "把内容写入文件。文件不存在时创建，存在时覆盖。自动创建上级目录。",
    parameters: {
      path: "要写入的文件路径（相对或绝对）",
      content: "要写入的内容",
    },
  },
  edit: {
    description: "用精确文本替换修改单个文件。每个 edits[].oldText 必须匹配原文件中唯一且互不重叠的区域。两处修改涉及同一块或相邻行时，合并为一个 edit，不要产生重叠的 edit。不要为了连接相距较远的修改而带上大段未改动的内容。",
    parameters: {
      path: "要修改的文件路径（相对或绝对）",
      edits: "一处或多处定向替换。每个 edit 都与原文件匹配，而不是逐次累加。不要包含重叠或嵌套的 edit；两处修改涉及同一块或相邻行时，合并为一个 edit。",
      "edits[].oldText": "一次定向替换的原文。它在原文件中必须唯一，且不能与同一次调用中其他 edits[].oldText 重叠。",
      "edits[].newText": "这次定向替换的新文本。",
    },
  },
  bash: {
    description: "在当前工作目录执行 bash 命令，返回 stdout 与 stderr。输出截断到最后 2000 行或 50KB（先到为准），截断时完整输出保存到临时文件。可选传入超时秒数。",
    parameters: {
      command: "要执行的 bash 命令",
      timeout: `超时秒数（可选，缺省 ${BASH_DEFAULT_TIMEOUT_S} 秒，上限 ${BASH_MAX_TIMEOUT_S} 秒）`,
    },
  },
};

/** 把需要 `{env}` 的内置工具转成无上下文的 HarnessTool；按语言换上说明与参数说明。 */
function bindEnv(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 内置工具各自的参数 schema 不同
  tool: AgentHarnessTool<ExecutionToolContext, any, any>, env: ExecutionEnv, lang: PromptLang, zh: BuiltinZh,
): HarnessTool {
  return {
    ...tool,
    ...(lang === "en" ? {} : { description: zh.description, parameters: schemaFor(lang, tool.parameters, zh.parameters) }),
    execute: (id, params, signal, onUpdate) => tool.execute(id, params, signal, onUpdate, { env }),
  } as HarnessTool;
}

function pathArg(args: Record<string, unknown>): string {
  return typeof args.path === "string" ? args.path : "";
}

const pathScope: PluginTool["pathScope"] = (args, cwd) => resolvePathScope(cwd, pathArg(args));
/** 读取另认 Skills 根目录为非敏感（SDD 17 §7.3）；写入不认。 */
const readPathScope: PluginTool["pathScope"] = (args, cwd, roots) => resolvePathScope(cwd, pathArg(args), roots);

function createRead(ctx: HarnessToolContext): HarnessTool {
  const env = ctx.execEnv!;
  const cwd = ctx.cwd!;
  const inner = bindEnv(createReadTool(), env, langOf(ctx), BUILTIN_ZH.read);
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
  const inner = bindEnv(op === "write" ? createWriteTool() : createEditTool(), ctx.execEnv!, langOf(ctx), BUILTIN_ZH[op]);
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

/**
 * SDD 16 §7.5：controlled 与 autonomous 挂载（effect `exec`）；controlled 只放行只读命令（规则 6）。pi 的 `NodeExecutionEnv` 在 `inheritEnv` 为真时
 * 会先合并整个 `process.env`，因此在 `prepare` 里关掉继承，只给白名单变量（D-6）。
 */
function createBash(ctx: HarnessToolContext): HarnessTool {
  const cwd = ctx.cwd!;
  const inner = bindEnv(createBashTool({
    prepare: (execution) => {
      execution.inheritEnv = false;
      execution.env = buildShellEnv(cwd) as Record<string, string>;
    },
  }), ctx.execEnv!, langOf(ctx), BUILTIN_ZH.bash);
  return {
    ...inner,
    async execute(id, params, signal, onUpdate) {
      const { timeout, clamped } = normalizeBashTimeout((params as { timeout?: unknown }).timeout);
      const result = (await inner.execute(id, { ...(params as object), timeout }, signal, onUpdate, undefined)) as AgentToolResult<unknown>;
      if (!clamped) return result;
      const note = { type: "text" as const, text: `[timeout capped at ${BASH_MAX_TIMEOUT_S} seconds]` };
      return { ...result, content: [note, ...result.content] };
    },
  };
}

const BASH_PROMPT: Bilingual = {
  en: " You can run shell commands with bash in the working directory. Commands get no credentials from Glaux. " +
    "Numbers you compute with bash are uncalibrated: report them as such and never present them as calibrated measurements; " +
    "use run_task for calibrated measurements.",
  zh: "你可以用 bash 在工作目录中运行 shell 命令。命令不会从 Glaux 获得任何凭据。" +
    "用 bash 算出的数值未经标定：要如实说明，绝不当作标定测量结果；标定测量请用 run_task。",
};

/** controlled 下的限制写进提示词，避免模型反复尝试会被拒绝的命令。 */
const BASH_READONLY_PROMPT: Bilingual = {
  en: ` In the current permission mode bash only runs read-only commands: ${READONLY_COMMANDS.join(", ")}, ` +
    "optionally joined with |, on paths inside the working directory that are not hidden. " +
    "Command chaining (; && ||), redirection, $ expansion, subshells, find -exec/-delete and other options that write files " +
    "or run programs are rejected. Use bash to list and search files, e.g. find . -maxdepth 2 or grep -rn.",
  zh: `当前权限模式下，bash 只运行只读命令：${READONLY_COMMANDS.join(", ")}，` +
    "可以用 | 串接，路径须在工作目录内且不是隐藏路径。" +
    "命令串联（; && ||）、重定向、$ 展开、子 shell、find -exec/-delete 以及其他会写文件或运行程序的选项都会被拒绝。" +
    "用 bash 列出和搜索文件，例如 find . -maxdepth 2 或 grep -rn。",
};

function bashPrompt(ctx: HarnessToolContext): string {
  const lang = langOf(ctx);
  return ctx.permissionMode === "controlled" ? BASH_PROMPT[lang] + BASH_READONLY_PROMPT[lang] : BASH_PROMPT[lang];
}

function filesPrompt(ctx: HarnessToolContext): string {
  if (langOf(ctx) === "zh") {
    const where = ctx.projectId ? "项目文件夹" : "本对话的私有工作区（删除对话时一并删除其中的文件）";
    return `你可以用 read、write、edit 读取和修改文件。相对路径以${where}为基准：${ctx.cwd}。` +
      "读写其外的路径，或 .env、.git 等隐藏路径，需要用户审批。" +
      "修改文件前先读取它；对已有文件的小改动优先用 edit。文本按 UTF-8 读写。";
  }
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
      name: READ_TOOL_NAME, effect: "read", pathScope: readPathScope, requires: {}, supports: () => true,
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
    {
      name: BASH_TOOL_NAME, effect: "exec", requires: {}, supports: () => true,
      permissionSubject: (args) => (typeof args.command === "string" ? args.command : undefined),
      patternMatch: bashPrefixMatch,
      readOnlyViolation: (args, cwd) => readOnlyViolation(typeof args.command === "string" ? args.command : "", cwd),
      create: createBash, promptFragment: bashPrompt,
    },
  ],
};
