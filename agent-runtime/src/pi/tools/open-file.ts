/**
 * `open_file`——按需打开项目内一个文件并让模型看见它（SDD 13 §4.2、§6.3、§7.3 规则 3～6）。
 *
 * - 与用户点击文件走同一端点 `POST /projects/{id}/objects`：backend 校验路径在项目根内、按后缀与
 *   魔数识别模态、必要时登记数据源，返回 `ObjectMeta`。
 * - 成功后按对象的缺省索引构造焦点（与前端 `defaultIndex` 同规则：z / t 取 0，level 取最粗层），
 *   经 SDD 10 观测通道取首帧或代表帧，以图像块返回模型。
 * - **不改变**会话的查看焦点（D-18）：`details` 以 `glaux.object_opened` 交给前端渲染对象卡片，
 *   用户点「在舞台打开」后才改焦点。`run_task` 等当前对象工具仍以用户焦点为准（§7.3 规则 5）。
 * - 越界、不支持的格式、文件损坏由 backend 以 422 返回，本工具以带错误码的工具错误交给模型，
 *   不中断回合（§7.3 规则 6）。
 *
 * 返回图像块，需连接声明 `vision: true` 才挂载（参照 SDD 03 D-21）。
 */

import type { ToolZh } from "../../i18n/prompt-lang.js";
import { Type, type ImageContent, type Static, type TextContent } from "@earendil-works/pi-ai";
import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";

import { backendBaseUrl } from "../../atlas/client.js";
import type { Axis, Focus, Index, ObjectKind, Observation } from "../../contracts.js";
import { fetchObservation } from "../../observation/index.js";
import { backendFailure, combinedSignal, unreachable } from "./project-backend.js";

export const OPEN_FILE_TOOL_NAME = "open_file";
export const OBJECT_OPENED_DETAILS_KIND = "glaux.object_opened";

const OpenFileParams = Type.Object({
  path: Type.String({
    description: "File to open, relative to the project root (e.g. \"cases/liver/scan_01.jpg\"). Use list_files to find it.",
  }),
});

export type OpenFileParams = Static<typeof OpenFileParams>;

/** SDD 10 §5.1 `ObjectMeta` 中本工具用到的字段。 */
export interface ProjectObjectMeta {
  id: string;
  kind: ObjectKind;
  modality: string;
  source_id: string;
  display_name?: string;
  axes: Axis[];
  calibration?: { kind: string } | null;
  streams?: { kind?: string; name?: string }[];
}

/** 对象卡片所需的精简 `ObjectMeta`；完整元数据由前端点「在舞台打开」时再取。 */
export interface OpenedObjectSummary {
  id: string;
  kind: ObjectKind;
  modality: string;
  source_id: string;
  display_name: string;
  axes: Axis[];
}

export interface ObjectOpenedDetails {
  kind: typeof OBJECT_OPENED_DETAILS_KIND;
  object: OpenedObjectSummary;
  /** 模型传入的项目内相对路径。 */
  path: string;
}

export interface OpenFileToolOptions {
  projectId: string;
  backendBaseUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  /** 超过这个字节数就不往模型送（默认 12 MiB），与 `view_current_image` 一致。 */
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 12 * 1024 * 1024;

/** 与前端 `data/actions.ts` 的 `defaultIndex` 同规则：z / t 取 0，level 取最粗层（最大下标）。 */
export function defaultIndex(axes: Axis[]): Index {
  const index: Index = {};
  for (const axis of axes) {
    if (axis.name === "z" || axis.name === "t") index[axis.name] = 0;
    if (axis.name === "level") index.level = axis.size - 1;
  }
  return index;
}

function describe(meta: ProjectObjectMeta): string {
  const size = (name: Axis["name"]) => meta.axes.find((axis) => axis.name === name);
  const parts = [`modality ${meta.modality}`, `kind ${meta.kind}`];
  const x = size("x");
  const y = size("y");
  if (x && y) parts.push(`${x.size}×${y.size} px`);
  const t = size("t");
  if (t) {
    parts.push(`${t.size} frames`);
    if (t.unit === "ms" && t.spacing) parts.push(`duration ≈ ${Math.round((t.size * t.spacing) / 1000)} s`);
  }
  const z = size("z");
  if (z) parts.push(`${z.size} slices`);
  const level = size("level");
  if (level) parts.push(`${level.size} pyramid levels`);
  if (meta.streams?.some((stream) => (stream.kind ?? stream.name) === "audio")) parts.push("has an audio track");
  if (meta.calibration) parts.push(`calibration ${meta.calibration.kind}`);
  return parts.join(", ");
}

export function createOpenFileTool(
  options: OpenFileToolOptions,
): AgentHarnessTool<undefined, typeof OpenFileParams, ObjectOpenedDetails> {
  const doFetch = options.fetch ?? fetch;
  const base = (options.backendBaseUrl ?? backendBaseUrl()).replace(/\/+$/u, "");
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  return {
    name: OPEN_FILE_TOOL_NAME,
    label: "Open a project file",
    description:
      "Open a file from the project folder bound to this conversation and look at it: returns its metadata and its " +
      "first or representative frame. Read-only; the path is relative to the project root and cannot leave it. " +
      "This does NOT change what the user has open on stage — tools that act on the current object (run_task etc.) " +
      "still use the user's stage. Errors such as outside_project, unsupported_format or corrupt mean the file " +
      "cannot be opened; do not retry the same path.",
    parameters: OpenFileParams,
    async execute(_toolCallId, params, signal) {
      const path = params.path.trim();
      if (!path) throw new Error("open_file needs a file path relative to the project root. Use list_files to find one.");
      const combined = combinedSignal(timeoutMs, signal);

      let response: Response;
      try {
        response = await doFetch(`${base}/projects/${encodeURIComponent(options.projectId)}/objects`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path }),
          signal: combined,
        });
      } catch (error) {
        throw unreachable("open_file", error);
      }
      if (!response.ok) throw await backendFailure(response, "open_file");

      const meta = (await response.json()) as ProjectObjectMeta;
      const object: OpenedObjectSummary = {
        id: meta.id,
        kind: meta.kind,
        modality: meta.modality,
        source_id: meta.source_id,
        display_name: meta.display_name || path.split("/").at(-1) || path,
        axes: meta.axes ?? [],
      };
      const details: ObjectOpenedDetails = { kind: OBJECT_OPENED_DETAILS_KIND, object, path };
      const head =
        `Opened ${path} as object ${object.id} ("${object.display_name}"): ${describe({ ...meta, axes: object.axes })}. ` +
        "The user's stage is unchanged; a card in the conversation lets the user open it on stage.";

      const focus: Focus = { object_id: object.id, kind: object.kind, index: defaultIndex(object.axes), region: null };
      let observation: Observation;
      try {
        observation = await fetchObservation(base, focus, { signal: combined, fetch: doFetch });
      } catch (error) {
        // 对象已登记、卡片仍可用；只是这次看不到画面，如实告诉模型。
        const reason = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `${head} Its preview frame could not be fetched (${reason}), so you have not seen it.` } satisfies TextContent],
          details,
        };
      }
      if (observation.bytes.byteLength > maxBytes) {
        return {
          content: [{
            type: "text",
            text: `${head} Its preview frame is ${Math.round(observation.bytes.byteLength / 1024)} KiB, too large to put in ` +
              `front of you (limit ${Math.round(maxBytes / 1024)} KiB), so you have not seen it.`,
          } satisfies TextContent],
          details,
        };
      }

      const frameIndex = Object.entries(observation.frame.index).filter(([, value]) => value != null)
        .map(([axis, value]) => `${axis}=${value}`).join(", ");
      return {
        content: [
          {
            type: "text",
            text:
              `${head} Below is its ${object.kind === "image" ? "image" : "first or representative frame"}` +
              `${frameIndex ? ` at ${frameIndex}` : ""}` +
              `${observation.time_ms !== undefined ? `, source time ${observation.time_ms} ms` : ""}` +
              ` (${observation.frame.width}×${observation.frame.height} px). Answer from the picture, not from the file name.`,
          } satisfies TextContent,
          { type: "image", data: Buffer.from(observation.bytes).toString("base64"), mimeType: observation.mime } satisfies ImageContent,
        ],
        details,
      };
    },
  };
}

/** 中文工具定义（SDD 20 §7.3）。 */
export const OPEN_FILE_ZH: ToolZh = {
  description: "打开本对话绑定的项目文件夹中的文件并查看：返回其元数据以及首帧或代表帧。只读；路径相对项目根目录且不能越出项目。它不会改变用户在舞台上打开的内容——作用于当前对象的工具（run_task 等）仍使用用户舞台上的对象。outside_project、unsupported_format、corrupt 等错误表示文件无法打开；不要对同一路径重试。",
  parameters: {
    path: "要打开的文件，相对项目根目录（例如 \"cases/liver/scan_01.jpg\"）。用 list_files 查找。",
  },
};
