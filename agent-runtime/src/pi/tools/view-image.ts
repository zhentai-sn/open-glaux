/**
 * `view_current_image`——把查看器里那张图的像素交给模型（SDD 02 §4.2 的补齐）。
 *
 * 在此之前，模型对"当前打开的图"的全部认知只有系统提示里那行
 * `Viewer context: image_id=…, modality=…`——那是**目录标签**，不是观察。于是
 * "当前打开的图像是什么"这类问题只能被复述成标签，用户看到的画面和模型说的内容
 * 一旦不一致（例如联调时塞进数据集的占位图），模型没有任何手段发现自己说错了。
 *
 * 按需取图而非每轮随 prompt 附图：图像 token 很贵，多数轮次（改标注、读指标、聊流程）
 * 根本不需要看图；让模型自己决定何时看，代价只在真要看的那一轮付。
 *
 * 与 `locate_roi` 的分工：本工具只负责"看见"，不产出坐标；要定位结构仍走 `locate_roi`
 * （它自带图谱先验与归一化坐标换算）。二者取图路径相同，都用 backend `/image/{id}`。
 *
 * 无外发门控：图只发往用户自己配的模型连接（与会话同一条），不经任何第三方。
 */

import { Type, type ImageContent, type Static, type TextContent } from "@earendil-works/pi-ai";
import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";

import { backendBaseUrl } from "../../atlas/client.js";
import type { ViewerContext } from "../../contracts.js";
import { RuntimeError } from "../../errors.js";
import { readImageSize } from "./locate-roi.js";

export const VIEW_CURRENT_IMAGE_TOOL_NAME = "view_current_image";
export const IMAGE_VIEWED_DETAILS_KIND = "glaux.image_viewed";

/** 无入参：看哪张图由查看器决定，不由模型指定——模型能指定就能指错。 */
const ViewCurrentImageParams = Type.Object({});

export type ViewCurrentImageParams = Static<typeof ViewCurrentImageParams>;

export interface ImageViewedDetails {
  kind: typeof IMAGE_VIEWED_DETAILS_KIND;
  payload: {
    image_id: string;
    /** 尺寸解析失败时为 null——不猜默认值，但也不因此拒绝把图给模型看。 */
    width: number | null;
    height: number | null;
    mime_type: string;
    bytes: number;
  };
}

export interface ViewCurrentImageToolOptions {
  viewer?: ViewerContext;
  backendBaseUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  /** 超过这个字节数就不往模型送（默认 12 MiB）——一张图撑爆上下文比看不到图更糟。 */
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 12 * 1024 * 1024;

function textOnly(text: string, details: ImageViewedDetails) {
  return { content: [{ type: "text", text } satisfies TextContent], details };
}

export function createViewCurrentImageTool(
  options: ViewCurrentImageToolOptions = {},
): AgentHarnessTool<undefined, typeof ViewCurrentImageParams, ImageViewedDetails> {
  const doFetch = options.fetch ?? fetch;
  const base = (options.backendBaseUrl ?? backendBaseUrl()).replace(/\/+$/u, "");
  const viewer = options.viewer ?? {};
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  return {
    name: VIEW_CURRENT_IMAGE_TOOL_NAME,
    label: "Look at the current image",
    description:
      "Look at the image currently open in the viewer — this returns the actual pixels the user is looking at. " +
      "Call it whenever the answer depends on what the image shows: the user asks what is open, what it depicts, " +
      "whether something is visible, how it looks, or before you judge, describe or comment on the image. " +
      "The image_id / modality / task in your viewer context are catalogue labels recorded by the dataset, not " +
      "observations — they can be wrong or stale, and they never tell you what is actually in the picture. " +
      "Takes no arguments; the viewer decides which image you get.",
    parameters: ViewCurrentImageParams,
    async execute(_toolCallId, _params, signal) {
      const abort = AbortSignal.timeout(timeoutMs);
      const combined = signal ? AbortSignal.any([signal, abort]) : abort;

      const imageId = viewer.image_id;
      const empty = (id: string, mime = ""): ImageViewedDetails => ({
        kind: IMAGE_VIEWED_DETAILS_KIND,
        payload: { image_id: id, width: null, height: null, mime_type: mime, bytes: 0 },
      });

      if (!imageId) {
        return textOnly(
          "No image is open in the viewer, so there is nothing to look at. Ask the user to open one.",
          empty(""),
        );
      }

      const res = await doFetch(`${base}/image/${encodeURIComponent(imageId)}`, { signal: combined });
      if (!res.ok) {
        throw new RuntimeError(
          "image_unavailable",
          `取图失败：HTTP ${res.status}（image_id=${imageId}）`,
          502,
        );
      }
      const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
      const bytes = new Uint8Array(await res.arrayBuffer());

      if (bytes.byteLength > maxBytes) {
        return textOnly(
          `${imageId} is ${Math.round(bytes.byteLength / 1024)} KiB, too large to put in front of you ` +
            `(limit ${Math.round(maxBytes / 1024)} KiB). Tell the user you cannot view this one directly; ` +
            `locate_roi still works on it.`,
          empty(imageId, mimeType),
        );
      }

      // 尺寸解析失败不阻断：坐标换算是 locate_roi 的事，看图本身不需要知道有多少像素。
      const dims = readImageSize(bytes);
      const details: ImageViewedDetails = {
        kind: IMAGE_VIEWED_DETAILS_KIND,
        payload: {
          image_id: imageId,
          width: dims?.width ?? null,
          height: dims?.height ?? null,
          mime_type: mimeType,
          bytes: bytes.byteLength,
        },
      };

      const labels = [
        viewer.task ? `task=${viewer.task}` : "",
        viewer.modality ? `modality=${viewer.modality}` : "",
        viewer.method ? `method=${viewer.method}` : "",
      ].filter(Boolean);

      return {
        content: [
          {
            type: "text",
            text:
              `This is ${imageId}${dims ? ` (${dims.width}×${dims.height} px)` : ""}, ` +
              "exactly what the user has open in the viewer." +
              (labels.length
                ? ` The dataset files it under ${labels.join(", ")} — that is a catalogue label, not an observation.` +
                  " If what you see does not match it, describe what you actually see and say the label disagrees."
                : "") +
              " Answer from the picture, not from the id.",
          } satisfies TextContent,
          { type: "image", data: Buffer.from(bytes).toString("base64"), mimeType } satisfies ImageContent,
        ],
        details,
      };
    },
  };
}
