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
 * SDD 22：模型可在这张图内指定区域放大、平移、缩回；每次看图登记一个视图编号，
 * 默认把已有标注画在图上，便于对照复核。看哪个对象、哪一层、哪一帧仍由查看器决定。
 *
 * 与 `locate_roi` 的分工：本工具只负责"看见"，不产出坐标；两者共用 fetchObservation。
 *
 * 无外发门控：图只发往用户自己配的模型连接（与会话同一条），不经任何第三方。
 */

import type { ToolZh } from "../../i18n/prompt-lang.js";
import { Type, type ImageContent, type Static, type TextContent } from "@earendil-works/pi-ai";
import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";

import { backendBaseUrl } from "../../atlas/client.js";
import type { OverlayEntry, ViewerContext } from "../../contracts.js";
import { RuntimeError } from "../../errors.js";
import { fetchObservation } from "../../observation/index.js";
import { objectSize, viewRegistryFor, type Box, type ViewRegistry } from "./view-registry.js";

export const VIEW_CURRENT_IMAGE_TOOL_NAME = "view_current_image";
export const IMAGE_VIEWED_DETAILS_KIND = "glaux.image_viewed";

/**
 * 看哪张图（对象、层、帧）由查看器决定，不由模型指定——模型能指定就能指错。
 * 模型只能在这张图内选区域放大、平移、缩回（SDD 22 D-1、D-2）。
 */
const ViewCurrentImageParams = Type.Object({
  region: Type.Optional(Type.Array(Type.Number(), {
    minItems: 4,
    maxItems: 4,
    description: "Optional [x0, y0, x1, y1] in object pixels (the coordinates a previous view reported) to zoom into. " +
      "Omit to see the whole image. A smaller region shows more detail; a larger one zooms back out.",
  })),
  annotations: Type.Optional(Type.Boolean({
    description: "Draw the annotations already on this image (default true). Set false to see the raw pixels under them.",
  })),
});

export type ViewCurrentImageParams = Static<typeof ViewCurrentImageParams>;

export interface ImageViewedDetails {
  kind: typeof IMAGE_VIEWED_DETAILS_KIND;
  payload: {
    image_id: string;
    /** 本命令内的视图编号（SDD 22 §9.2）；未取到图时缺省。 */
    view_id?: string;
    /** 看的对象区域；null 为全图或查看器选区。 */
    region?: Box | null;
    /** 叠加的标注条数。 */
    overlay?: number;
    /** 无焦点或超出字节上限时为 null；有图时取自 ReferenceFrame。 */
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
  /** 本命令的视图登记（SDD 22 §7.2）；缺省为独立的新表。 */
  views?: ViewRegistry;
}

const DEFAULT_MAX_BYTES = 12 * 1024 * 1024;
/** 输出最长边（SDD 22 §7.1 规则 2）：区域更小时 backend 按原分辨率返回。 */
const VIEW_SIZE = 1024;

function textOnly(text: string, details: ImageViewedDetails) {
  return { content: [{ type: "text", text } satisfies TextContent], details };
}

/** 校验区域并截到对象范围；非法或与对象无交集时返回原因（SDD 22 §7.1 规则 1）。 */
export function clampRegion(region: readonly number[], size: [number, number] | undefined): Box | string {
  const [x0, y0, x1, y1] = region;
  if (region.length !== 4 || x0 === undefined || y0 === undefined || x1 === undefined || y1 === undefined
    || ![x0, y0, x1, y1].every(Number.isFinite)) {
    return "region must be four numbers [x0, y0, x1, y1] in object pixels.";
  }
  if (!(x0 < x1) || !(y0 < y1)) return "region needs x0 < x1 and y0 < y1.";
  if (!size) return [x0, y0, x1, y1];
  const box: Box = [Math.max(0, x0), Math.max(0, y0), Math.min(size[0], x1), Math.min(size[1], y1)];
  if (!(box[0] < box[2]) || !(box[1] < box[3])) {
    return `region does not overlap the image, which spans x 0–${size[0]}, y 0–${size[1]} in object pixels.`;
  }
  return box;
}

const fmt = (n: number) => String(Math.round(n * 10) / 10);

function overlayText(entries: OverlayEntry[]): string {
  if (!entries.length) return " No annotations are drawn on this view.";
  const lines = entries.map((e) =>
    `${e.tag} = ${e.annotation_id}${e.label ? ` "${e.label}"` : ""}, ${e.status}${e.source ? ` by ${e.source}` : ""}`);
  return ` Annotations drawn (dashed = suggestion awaiting the user): ${lines.join("; ")}.`;
}

export function createViewCurrentImageTool(
  options: ViewCurrentImageToolOptions = {},
): AgentHarnessTool<undefined, typeof ViewCurrentImageParams, ImageViewedDetails> {
  const doFetch = options.fetch ?? fetch;
  const base = (options.backendBaseUrl ?? backendBaseUrl()).replace(/\/+$/u, "");
  const viewer = options.viewer ?? {};
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const views = options.views ?? viewRegistryFor(undefined);

  return {
    name: VIEW_CURRENT_IMAGE_TOOL_NAME,
    label: "Look at the current image",
    description:
      "Look at the image currently open in the viewer — this returns the actual pixels the user is looking at. " +
      "Call it whenever the answer depends on what the image shows: the user asks what is open, what it depicts, " +
      "whether something is visible, how it looks, or before you judge, describe or comment on the image. " +
      "The object id / collection / task in your viewer context are catalogue labels recorded by the dataset, not " +
      "observations — they can be wrong or stale, and they never tell you what is actually in the picture. " +
      "You may zoom: pass region to look closer at part of the image, and call it again to pan or zoom out. " +
      "Existing annotations are drawn on the picture so you can check them. The viewer decides which image you get.",
    parameters: ViewCurrentImageParams,
    async execute(_toolCallId, params, signal) {
      const abort = AbortSignal.timeout(timeoutMs);
      const combined = signal ? AbortSignal.any([signal, abort]) : abort;

      const focus = viewer.focus;
      const imageId = focus?.object_id;
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

      const size = objectSize(viewer);
      let region: Box | null = null;
      if (params.region !== undefined) {
        const clamped = clampRegion(params.region, size);
        if (typeof clamped === "string") return textOnly(`Not viewed: ${clamped}`, empty(imageId));
        region = clamped;
      }
      const wantOverlay = params.annotations !== false;

      let observation;
      try {
        observation = await fetchObservation(base, focus, {
          signal: combined,
          fetch: doFetch,
          size: VIEW_SIZE,
          overlay: wantOverlay,
          ...(region ? { region: { kind: "box" as const, x0: region[0], y0: region[1], x1: region[2], y1: region[3] } } : {}),
        });
      } catch (error) {
        // 区域超出取帧上限等请求问题：如实告诉模型换个区域，不中断命令（SDD 22 §7.1 规则 3）
        if (region && error instanceof RuntimeError && /HTTP 4\d\d/u.test(error.message)) {
          return textOnly(`Not viewed: ${error.message}. Choose a smaller region.`, empty(imageId));
        }
        throw error;
      }
      const { bytes, frame } = observation;
      const mimeType = observation.mime;

      if (bytes.byteLength > maxBytes) {
        return textOnly(
          `${imageId} is ${Math.round(bytes.byteLength / 1024)} KiB, too large to put in front of you ` +
            `(limit ${Math.round(maxBytes / 1024)} KiB). Tell the user you cannot view this one directly; ` +
            `locate_roi still works on it.`,
          empty(imageId, mimeType),
        );
      }

      const view = views.add(frame, region);
      const overlay = observation.overlay ?? [];
      const overlayNote = !wantOverlay
        ? " Annotations are not drawn on this view."
        : observation.overlay === undefined
          ? " Annotations could not be drawn on this view (the image service did not return them)."
          : overlayText(overlay);
      const details: ImageViewedDetails = {
        kind: IMAGE_VIEWED_DETAILS_KIND,
        payload: {
          image_id: imageId,
          view_id: view.id,
          region,
          overlay: overlay.length,
          width: frame.width,
          height: frame.height,
          mime_type: mimeType,
          bytes: bytes.byteLength,
        },
      };

      const labels = [
        viewer.task ? `task=${viewer.task}` : "",
        viewer.collection ? `collection=${viewer.collection}` : "",
        viewer.method ? `method=${viewer.method}` : "",
      ].filter(Boolean);
      const frameIndex = Object.entries(frame.index).filter(([, value]) => value != null)
        .map(([axis, value]) => `${axis}=${value}`).join(", ");
      // 换算以 X-Glaux-Frame 为准：帧像素 = (对象坐标 − origin) × scale
      const [ox, oy] = frame.origin;
      const covered = `x ${fmt(ox)}–${fmt(ox + frame.width / frame.scale)}, y ${fmt(oy)}–${fmt(oy + frame.height / frame.scale)}`;
      const whole = size ? ` of the ${size[0]}×${size[1]} object` : "";

      return {
        content: [
          {
            type: "text",
            text:
              `View ${view.id}: ${imageId}${frameIndex ? ` at ${frameIndex}` : ""}` +
              `${observation.time_ms !== undefined ? `, source time ${observation.time_ms} ms` : ""}` +
              `, exactly what the user has open in the viewer. This picture is ${frame.width}×${frame.height} px and ` +
              `covers object pixels ${covered}${whole}; 1 picture pixel = ${fmt(1 / frame.scale)} object pixels.` +
              (labels.length
                ? ` The dataset files it under ${labels.join(", ")} — that is a catalogue label, not an observation.` +
                  " If what you see does not match it, describe what you actually see and say the label disagrees."
                : "") +
              " Answer from the picture, not from the id." +
              overlayNote +
              ` To zoom, call view_current_image with region in object pixels. When proposing or revising an annotation ` +
              `from pixels of this picture, pass space "view" and view_id "${view.id}".`,
          } satisfies TextContent,
          { type: "image", data: Buffer.from(bytes).toString("base64"), mimeType } satisfies ImageContent,
        ],
        details,
      };
    },
  };
}

/** 中文工具定义（SDD 20 §7.3）。 */
export const VIEW_CURRENT_IMAGE_ZH: ToolZh = {
  description: "查看查看器中当前打开的图像——返回用户正在看的实际像素。只要答案取决于画面内容就调用它：用户问打开的是什么、画面描绘了什么、某物是否可见、看起来怎样，或在你判断、描述、评论图像之前。查看器上下文中的对象 id、集合、任务是数据集记录的目录标签，不是观察结果——它们可能有误或过时，也从不告诉你画面里实际有什么。你可以缩放：传 region 放大查看图像的一部分，再次调用即可平移或缩回。图上会画出已有标注，便于你核对。看哪张图像由查看器决定。",
  parameters: {
    region: "可选，[x0, y0, x1, y1]，对象像素坐标（以上一次视图报告的坐标为准），表示要放大查看的区域。省略则查看全图。区域越小细节越多；选更大的区域即可缩回。",
    annotations: "是否在图上画出已有标注（缺省 true）。设为 false 可查看标注下方的原始像素。",
  },
};
