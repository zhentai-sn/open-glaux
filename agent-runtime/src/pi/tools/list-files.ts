/**
 * `list_files`——列出会话项目内一层目录（SDD 13 §4.2、§7.3 规则 2）。
 *
 * - 只读、只列一层；路径为项目根内相对路径，越界由 backend 以 422 `outside_project` 拒绝。
 * - 单次最多交给模型 200 条；超出时文本写明总数并提示缩小范围，避免大目录撑爆上下文。
 * - 只对绑定了项目的会话挂载（§7.3 规则 1），项目 id 由 harness 从 Pi 会话 metadata 读出，
 *   不由模型指定。
 * - 工具说明提示候选模态为 `-` 的文件可用 `read_file` 读取（SDD 14 §7.4 规则 6）。
 */

import { Type, type Static, type TextContent } from "@earendil-works/pi-ai";
import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";

import { backendBaseUrl } from "../../atlas/client.js";
import { backendFailure, combinedSignal, unreachable } from "./project-backend.js";

export const LIST_FILES_TOOL_NAME = "list_files";
export const FILES_LISTED_DETAILS_KIND = "glaux.files_listed";
export const LIST_FILES_LIMIT = 200;

const ListFilesParams = Type.Object({
  path: Type.Optional(
    Type.String({
      description:
        "Directory to list, relative to the project root (e.g. \"cases/liver\"). Omit or leave empty for the root.",
    }),
  ),
});

export type ListFilesParams = Static<typeof ListFilesParams>;

/** SDD 13 §9.1 `ProjectEntry`。 */
export interface ProjectEntry {
  name: string;
  path: string;
  type: "dir" | "file";
  /** 只按后缀判定的候选模态；无法识别为 null。 */
  modality: string | null;
  /** 该文件已登记时的对象 id。 */
  object_id: string | null;
}

export interface FilesListedDetails {
  kind: typeof FILES_LISTED_DETAILS_KIND;
  path: string;
  entries: ProjectEntry[];
  /** 该目录下的条目总数；大于 `entries.length` 表示被截断。 */
  total: number;
}

export interface ListFilesToolOptions {
  projectId: string;
  backendBaseUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

function line(entry: ProjectEntry): string {
  if (entry.type === "dir") return `dir\t${entry.path}/`;
  return [
    "file",
    entry.path,
    entry.modality ?? "-",
    entry.object_id ? `opened as ${entry.object_id}` : "not opened",
  ].join("\t");
}

export function createListFilesTool(
  options: ListFilesToolOptions,
): AgentHarnessTool<undefined, typeof ListFilesParams, FilesListedDetails> {
  const doFetch = options.fetch ?? fetch;
  const base = (options.backendBaseUrl ?? backendBaseUrl()).replace(/\/+$/u, "");
  const timeoutMs = options.timeoutMs ?? 15_000;

  return {
    name: LIST_FILES_TOOL_NAME,
    label: "List project files",
    description:
      "List one level of the project folder bound to this conversation (read-only). Returns directories and files " +
      "with their candidate modality (guessed from the extension; \"-\" means Glaux cannot open it as a visual object such as an image, video, CT volume or slide) " +
      "and whether the " +
      "file is already opened as a Glaux object. Paths are relative to the project root and cannot leave it. " +
      `At most ${LIST_FILES_LIMIT} entries are returned; list a subdirectory to narrow down. ` +
      "Files with candidate modality \"-\" may be text (reports, notes, JSON, configs, scripts); read them with read_file.",
    parameters: ListFilesParams,
    async execute(_toolCallId, params, signal) {
      const url = new URL(`${base}/projects/${encodeURIComponent(options.projectId)}/entries`);
      const requested = params.path?.trim() ?? "";
      if (requested) url.searchParams.set("path", requested);

      let response: Response;
      try {
        response = await doFetch(url, { signal: combinedSignal(timeoutMs, signal) });
      } catch (error) {
        throw unreachable("list_files", error);
      }
      if (!response.ok) throw await backendFailure(response, "list_files");

      const body = (await response.json()) as { path?: unknown; entries?: unknown; total?: unknown };
      const all = Array.isArray(body.entries) ? (body.entries as ProjectEntry[]) : [];
      const total = typeof body.total === "number" && Number.isInteger(body.total) ? Math.max(body.total, all.length) : all.length;
      const entries = all.slice(0, LIST_FILES_LIMIT);
      const path = typeof body.path === "string" ? body.path : requested;
      const where = path ? `"${path}"` : "the project root";

      const lines = [
        entries.length
          ? `${where} contains ${total} entr${total === 1 ? "y" : "ies"} (type, path, candidate modality, status):`
          : `${where} is empty.`,
        ...entries.map(line),
      ];
      if (total > entries.length) {
        lines.push(
          `Only the first ${entries.length} of ${total} entries are shown. ` +
            "List a subdirectory to narrow the range instead of guessing file names.",
        );
      }
      return {
        content: [{ type: "text", text: lines.join("\n") } satisfies TextContent],
        details: { kind: FILES_LISTED_DETAILS_KIND, path, entries, total },
      };
    },
  };
}
