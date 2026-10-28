/**
 * `estimate_depth`（SDD 25 §7.1 depth-dav2s）：对当前查看器帧做单目相对深度估计。
 *
 * 依赖可选组件 `depth-dav2s`（未安装时本工具不挂载）。取帧复用 `fetchObservation`，
 * 推理在 backend 的 vision-runtime 隔离子进程里完成；本工具只搬运字节与结果。
 */
import type { ToolZh } from "../../i18n/prompt-lang.js";
import { Type, type ImageContent, type Static, type TextContent } from "@earendil-works/pi-ai";
import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";

import { backendBaseUrl } from "../../atlas/client.js";
import type { ViewerContext } from "../../contracts.js";
import { RuntimeError } from "../../errors.js";
import { fetchObservation } from "../../observation/index.js";

export const ESTIMATE_DEPTH_TOOL_NAME = "estimate_depth";
export const DEPTH_ESTIMATED_DETAILS_KIND = "glaux.depth_estimated";
export const DEPTH_PACK_ID = "depth-dav2s";

const DEPTH_SIZE = 518;

const EstimateDepthParams = Type.Object({});

export type EstimateDepthParams = Static<typeof EstimateDepthParams>;

export interface DepthEstimatedDetails {
  kind: typeof DEPTH_ESTIMATED_DETAILS_KIND;
  payload: {
    object_id: string;
    pack_id: string;
    depth_mean: number;
    depth_min: number;
    depth_max: number;
    near_ratio: number;
    far_ratio: number;
  };
}

interface InferResponse {
  depth: { min: number; max: number; mean: number; median: number; p01: number; p99: number };
  near_ratio: number;
  mid_ratio: number;
  far_ratio: number;
  preview_png_base64?: string;
}

export function createEstimateDepthTool(
  options: { viewer?: ViewerContext; backendBaseUrl?: string },
): AgentHarnessTool<undefined, typeof EstimateDepthParams, DepthEstimatedDetails> {
  const base = (options.backendBaseUrl ?? backendBaseUrl()).replace(/\/+$/u, "");
  const viewer = options.viewer;

  return {
    name: ESTIMATE_DEPTH_TOOL_NAME,
    label: "Estimate depth of the current image",
    description:
      "Estimate a monocular relative depth map for the image currently open in the viewer. " +
      "Use it when the question depends on how far or how close things are in the picture, or when you need " +
      "a coarse 3D arrangement of the scene. Values are relative (no real-world scale); the returned image " +
      "shows near as bright and far as dark. It requires the 'depth-dav2s' model pack to be installed.",
    parameters: EstimateDepthParams,
    async execute(_toolCallId, _params, signal) {
      const focus = viewer?.focus;
      if (!focus) {
        throw new RuntimeError("no_focus", "No image is open in the viewer.", 409);
      }

      const observation = await fetchObservation(base, focus, {
        size: DEPTH_SIZE,
        ...(signal ? { signal } : {}),
      });

      const res = await (globalThis.fetch ?? fetch)(`${base}/packs/${DEPTH_PACK_ID}/infer`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: observation.bytes,
        ...(signal ? { signal } : {}),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new RuntimeError(
          "inference_failed",
          `Depth inference failed: HTTP ${res.status} ${detail.slice(0, 200)}`,
          502,
        );
      }
      const data = (await res.json()) as InferResponse;

      const details: DepthEstimatedDetails = {
        kind: DEPTH_ESTIMATED_DETAILS_KIND,
        payload: {
          object_id: focus.object_id,
          pack_id: DEPTH_PACK_ID,
          depth_mean: data.depth.mean,
          depth_min: data.depth.min,
          depth_max: data.depth.max,
          near_ratio: data.near_ratio,
          far_ratio: data.far_ratio,
        },
      };

      const text =
        `Relative depth for ${focus.object_id} (model depth-dav2s, relative scale — no metric unit): ` +
        `mean=${data.depth.mean.toFixed(3)}, range=[${data.depth.min.toFixed(3)}, ${data.depth.max.toFixed(3)}], ` +
        `near ${(data.near_ratio * 100).toFixed(1)}%, mid ${(data.mid_ratio * 100).toFixed(1)}%, ` +
        `far ${(data.far_ratio * 100).toFixed(1)}% of pixels. ` +
        `The image below is the depth visualisation (bright = near, dark = far).`;

      const content: (TextContent | ImageContent)[] = [{ type: "text", text }];
      if (data.preview_png_base64) {
        content.push({ type: "image", data: data.preview_png_base64, mimeType: "image/png" });
      }
      return { content, details };
    },
  };
}

export const estimateDepthZh: ToolZh = {
  parameters: {},
  description:
    "对查看器中当前打开的图像做单目相对深度估计。当问题取决于画面里远近关系，或需要粗略的三维布局时使用。" +
    "数值是相对的（没有真实尺度）；返回的图里近处偏亮、远处偏暗。需要安装 depth-dav2s 模型组件。",
};
