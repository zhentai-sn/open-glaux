/**
 * `estimate_depth`（SDD 25 §7.1 depth-dav2s）：对当前查看器帧做单目相对深度估计。
 *
 * 依赖可选组件 `depth-dav2s`（未安装时本工具不挂载）。取帧复用 `fetchObservation`，
 * 推理在 backend 的 vision-runtime 隔离子进程里完成；本工具只搬运字节与结果。
 */
import { langOf, type Bilingual, type ToolZh } from "../../i18n/prompt-lang.js";
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

/**
 * 工具自带的提示词片段（SDD 15 §7.1）：只在 `estimate_depth` 已挂载时随插件片段下发。
 * 放在工具上而不是系统提示词，理由：① 系统提示词是跨能力恒真内容，工具约定不属于它；
 * ② base prompt 无条件下发，pack 未安装时会把一个不存在的工具讲给模型；
 * ③ 工具随插件增删，指引应跟着生命周期走，而不是每次改 base prompt。
 */
const DEPTH_PROMPT: Bilingual = {
  en: " Questions about depth, distance or the 3D layout of the current image go to estimate_depth: " +
    "call it instead of inferring depth order from occlusion, perspective or relative size, and do not treat " +
    "the absence of a depth task in run_task as evidence that Glaux cannot do it.",
  zh: "涉及当前图像的深度、远近或三维布局时，调用 estimate_depth：不要凭遮挡、透视或大小自行推断远近，" +
    "也不要把 run_task 里没有深度任务当成 Glaux 做不到。",
};

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
  /** 写进项目目录时的相对路径（会话绑定项目且落盘成功才有）。 */
  saved_path?: string;
}

export const estimateDepthPrompt = (options: { lang?: unknown } = {}): string =>
  DEPTH_PROMPT[langOf(options as never)];

export function createEstimateDepthTool(
  options: { viewer?: ViewerContext; backendBaseUrl?: string; projectId?: string },
): AgentHarnessTool<undefined, typeof EstimateDepthParams, DepthEstimatedDetails> {
  const base = (options.backendBaseUrl ?? backendBaseUrl()).replace(/\/+$/u, "");
  const viewer = options.viewer;

  return {
    name: ESTIMATE_DEPTH_TOOL_NAME,
    label: "Estimate depth of the current image",
    description:
      "Estimate a depth map with a real model instead of inferring distance from appearance. " +
      "Always call this before answering any question about depth, distance, near/far ordering, or the 3D " +
      "layout of the current image — do NOT deduce depth order from occlusion, perspective, relative size or " +
      "texture; those are guesses and must not be presented as measurement. Returns relative depth statistics " +
      "(near/mid/far pixel ratios, no metric scale) plus a depth image, and saves that image into the current " +
      "project so the user can open it.",
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

      const query = new URLSearchParams();
      if (options.projectId) {
        query.set("project_id", options.projectId);
        // 文件名带对象与时间，避免同名覆盖；落在项目的 glaux-output/ 下
        query.set("save_name", `depth-${focus.object_id}-${Date.now()}.png`);
      }
      const suffix = query.toString() ? `?${query.toString()}` : "";

      const res = await (globalThis.fetch ?? fetch)(`${base}/packs/${DEPTH_PACK_ID}/infer${suffix}`, {
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

      const saved = data.saved_path
        ? ` The depth image was saved to the project as ${data.saved_path} — open it from the file panel if the user wants to look at it.`
        : "";
      const content: (TextContent | ImageContent)[] = [{ type: "text", text: text + saved }];
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
