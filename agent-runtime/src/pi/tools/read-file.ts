/**
 * `read_file`——按行区间分段读取项目内一个文本文件（SDD 14 §4.2、§7.4、§9.2）。
 *
 * - 走 `GET /projects/{id}/text`（§9.1）：越界、隐藏路径、二进制、不存在由 backend 以 4xx 拒绝，
 *   本工具以带错误码的工具错误交给模型，不中断回合（§7.4 规则 5）。
 * - 单次至多 400 行、固定 `max_bytes = 65536`（§7.4 规则 2、D-3）；正文每行带行号前缀，
 *   单行超过 2000 字符截断并标注（规则 3）；末尾写明续读起点或总行数（规则 4）。
 * - 只对绑定项目的会话挂载，项目 id 由 harness 从 Pi 会话 metadata 读出，不由模型指定；
 *   不接受对象 id，故不做项目越界判定。
 * - 不改变会话的 `focus` 与 `document`（规则 7）：`details` 以 `glaux.file_read` 交给前端渲染文件卡片。
 */

import { Type, type Static, type TextContent } from "@earendil-works/pi-ai";
import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";

import { backendBaseUrl } from "../../atlas/client.js";
import { backendFailure, combinedSignal, unreachable } from "./project-backend.js";

export const READ_FILE_TOOL_NAME = "read_file";
export const FILE_READ_DETAILS_KIND = "glaux.file_read";
/** 单次行数上限与缺省值（§4.2）。 */
export const READ_FILE_MAX_LINES = 400;
/** 单次字节上限（§7.4 规则 2）。 */
export const READ_FILE_MAX_BYTES = 65_536;
/** 交给模型的单行字符上限（§7.4 规则 3）。 */
export const READ_FILE_LINE_CHARS = 2_000;

const LINE_TRUNCATED_MARK = "[line truncated]";

const ReadFileParams = Type.Object({
  path: Type.String({
    description:
      "Text file to read, relative to the project root (e.g. \"notes/README.md\"). Use list_files to find it.",
  }),
  start_line: Type.Optional(
    Type.Integer({ minimum: 1, description: "First line to read, counting from 1 (default 1)." }),
  ),
  max_lines: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: READ_FILE_MAX_LINES,
      description: `Number of lines to read (default and maximum ${READ_FILE_MAX_LINES}).`,
    }),
  ),
});

export type ReadFileParams = Static<typeof ReadFileParams>;

/** SDD 14 §9.1 `ProjectText`。 */
export interface ProjectText {
  path: string;
  name: string;
  size: number;
  encoding: "utf-8" | "utf-8-sig" | "utf-16" | "gb18030";
  start_line: number;
  /** 未读到任何行时为 `start_line - 1`。 */
  end_line: number;
  /** 换行统一为 `\n`，不含行号。 */
  text: string;
  eof: boolean;
  /** 仅 `eof` 为真时给出。 */
  total_lines: number | null;
  /** 最后一行是否因字节上限被截断。 */
  line_truncated: boolean;
}

/** SDD 14 §9.2。 */
export interface FileReadDetails {
  kind: typeof FILE_READ_DETAILS_KIND;
  path: string;
  name: string;
  start_line: number;
  end_line: number;
  eof: boolean;
  total_lines: number | null;
}

export interface ReadFileToolOptions {
  projectId: string;
  backendBaseUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

/** 截到 `READ_FILE_LINE_CHARS` 个 UTF-16 码元，不拆代理对。 */
function clip(content: string): { content: string; clipped: boolean } {
  if (content.length <= READ_FILE_LINE_CHARS) return { content, clipped: false };
  let end = READ_FILE_LINE_CHARS;
  const last = content.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return { content: content.slice(0, end), clipped: true };
}

function numbered(body: ProjectText): string[] {
  const count = Math.max(0, body.end_line - body.start_line + 1);
  if (count === 0) return [];
  // 正文末尾是否带换行契约未写死：按行区间取前 count 段，两种写法结果一致。
  const lines = body.text.split("\n").slice(0, count);
  return lines.map((raw, i) => {
    const { content, clipped } = clip(raw);
    const byteCut = body.line_truncated && i === count - 1;
    return `${body.start_line + i}\t${content}${clipped || byteCut ? ` ${LINE_TRUNCATED_MARK}` : ""}`;
  });
}

function header(body: ProjectText): string {
  const meta = `${body.encoding}, ${body.size} bytes`;
  if (body.end_line < body.start_line) {
    return body.total_lines === 0
      ? `${body.path} is empty (${meta}).`
      : `${body.path}: no lines from line ${body.start_line} (${meta}).`;
  }
  return `${body.path}: lines ${body.start_line}-${body.end_line} (${meta}), shown as "<line number>\\t<content>":`;
}

function footer(body: ProjectText): string {
  if (!body.eof) return `Continue with start_line=${body.end_line + 1}.`;
  const total = body.total_lines ?? body.end_line;
  return `End of file; the file has ${total} line${total === 1 ? "" : "s"} in total.`;
}

export function createReadFileTool(
  options: ReadFileToolOptions,
): AgentHarnessTool<undefined, typeof ReadFileParams, FileReadDetails> {
  const doFetch = options.fetch ?? fetch;
  const base = (options.backendBaseUrl ?? backendBaseUrl()).replace(/\/+$/u, "");
  const timeoutMs = options.timeoutMs ?? 15_000;

  return {
    name: READ_FILE_TOOL_NAME,
    label: "Read project file",
    description:
      "Read a text file in the project folder bound to this conversation (read-only), by line range. Each line is " +
      "prefixed with its line number and a tab. At most " +
      `${READ_FILE_MAX_LINES} lines or 64 KiB are returned per call; when the file continues, the result says which ` +
      "start_line to use next. Lines longer than 2000 characters are cut and marked \"[line truncated]\". Paths are " +
      "relative to the project root and cannot leave it; hidden paths (any segment starting with \".\") and binary " +
      "files are rejected.",
    parameters: ReadFileParams,
    async execute(_toolCallId, params, signal) {
      const path = params.path?.trim() ?? "";
      if (!path) throw new Error("read_file needs a file path relative to the project root. Use list_files to find one.");
      const startLine = Math.max(1, integer(params.start_line) ?? 1);
      const maxLines = Math.min(READ_FILE_MAX_LINES, Math.max(1, integer(params.max_lines) ?? READ_FILE_MAX_LINES));

      const url = new URL(`${base}/projects/${encodeURIComponent(options.projectId)}/text`);
      url.searchParams.set("path", path);
      url.searchParams.set("start_line", String(startLine));
      url.searchParams.set("max_lines", String(maxLines));
      url.searchParams.set("max_bytes", String(READ_FILE_MAX_BYTES));

      let response: Response;
      try {
        response = await doFetch(url, { signal: combinedSignal(timeoutMs, signal) });
      } catch (error) {
        throw unreachable("read_file", error);
      }
      if (!response.ok) throw await backendFailure(response, "read_file");

      const raw = (await response.json()) as Partial<ProjectText>;
      const start = integer(raw.start_line) ?? startLine;
      const body: ProjectText = {
        path: typeof raw.path === "string" ? raw.path : path,
        name: typeof raw.name === "string" ? raw.name : path.split("/").at(-1) ?? path,
        size: integer(raw.size) ?? 0,
        encoding: raw.encoding ?? "utf-8",
        start_line: start,
        end_line: integer(raw.end_line) ?? start - 1,
        text: typeof raw.text === "string" ? raw.text : "",
        eof: raw.eof === true,
        total_lines: integer(raw.total_lines) ?? null,
        line_truncated: raw.line_truncated === true,
      };

      const text = [header(body), ...numbered(body), footer(body)].join("\n");
      return {
        content: [{ type: "text", text } satisfies TextContent],
        details: {
          kind: FILE_READ_DETAILS_KIND,
          path: body.path,
          name: body.name,
          start_line: body.start_line,
          end_line: body.end_line,
          eof: body.eof,
          total_lines: body.total_lines,
        },
      };
    },
  };
}
