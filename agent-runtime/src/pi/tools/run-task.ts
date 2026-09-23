/**
 * `run_task`——命中任务注册表能力时的领域工具（SDD 02 §7.2 第 1 条，长期保留）：让参考智能体能真正**执行**一次科学内核任务（分割 + 测量）。
 *
 * 退役 orchestration P3 的必要条件（设计 §3.3 / §5-Q1）：删掉 backend `/interpret` 意图闸门后，
 * "自然语言 → 跑当前任务"这条路必须由 agent 的工具调用接住。本工具直接封装 backend
 * `POST /task/run`（science-core 的 REST 执行面），不做任何 NL 解析——意图理解回归模型本身。
 *
 * - 缺省取前端随命令下发的 `ViewerContext`（当前图 / 当前任务）；模型可显式覆盖 image_id / task。
 * - 结果：给模型一段可读的度量摘要（content），并把完整 TaskOutput 放进 `details`
 *   （`kind: "glaux.task_output"`），前端经 `tool_result` 事件把 primitives / metrics 写回查看器。
 * - 不做 SSRF 守卫：目标固定为本机 backend（`GLAUX_BACKEND_URL`，缺省 127.0.0.1:8000），非用户输入。
 *
 * SDD 02 落地 `locate_roi / segment_region / propose_annotation` 后，本工具由更细粒度的工具集取代。
 */

import { Type, type Static } from "@earendil-works/pi-ai";
import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";

import type { ViewerContext } from "../../contracts.js";

export const RUN_TASK_TOOL_NAME = "run_task";
export const TASK_OUTPUT_DETAILS_KIND = "glaux.task_output";

const DEFAULT_BACKEND_URL = "http://127.0.0.1:8000";

const RunTaskParams = Type.Object({
  image_id: Type.Optional(
    Type.String({
      description:
        "Image / volume / slide id to analyse. Defaults to the image currently open in the viewer.",
    }),
  ),
  task: Type.Optional(
    Type.String({
      description:
        "Task type id from the registry (e.g. far_wall_cca_imt, fetal_hc, totalseg_liver_kidney, nuclei_detection). Defaults to the viewer's current task.",
    }),
  ),
  method: Type.Optional(
    Type.String({ description: "Segmentation adapter / model id override (optional)." }),
  ),
});

export type RunTaskParams = Static<typeof RunTaskParams>;

export interface RunTaskDetails {
  kind: typeof TASK_OUTPUT_DETAILS_KIND;
  task: string;
  image_id: string;
  output: TaskOutputLike;
}

/** backend `/task/run` 响应的最小形状（镜像 glaux_core.contracts.TaskOutput 的 JSON 视图）。 */
export interface TaskOutputLike {
  task?: string;
  metrics: Record<string, { value: number; unit: string; label_en?: string; label_zh?: string }>;
  primitives: unknown[];
  provenance: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RunTaskToolOptions {
  viewer?: ViewerContext;
  backendBaseUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export function backendBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.GLAUX_BACKEND_URL?.trim() || DEFAULT_BACKEND_URL).replace(/\/+$/u, "");
}

function summarize(task: string, imageId: string, output: TaskOutputLike): string {
  const lines = Object.entries(output.metrics ?? {}).map(([key, m]) => {
    const label = m.label_en || key;
    const value = Number.isFinite(m.value) ? roundSmart(m.value) : String(m.value);
    return `- ${label} (${key}): ${value} ${m.unit ?? ""}`.trimEnd();
  });
  const model = output.provenance?.model_version;
  const head = `Task ${task} completed on ${imageId}${model ? ` (model ${String(model)})` : ""}.`;
  if (!lines.length) return `${head}\nNo metrics were produced.`;
  return `${head}\nMetrics:\n${lines.join("\n")}\nThe overlays and measurements are now shown in the viewer.`;
}

function roundSmart(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1000) return v.toFixed(0);
  if (abs >= 10) return v.toFixed(1);
  return v.toFixed(3);
}

export function createRunTaskTool(
  options: RunTaskToolOptions = {},
): AgentHarnessTool<undefined, typeof RunTaskParams, RunTaskDetails> {
  const doFetch = options.fetch ?? fetch;
  const base = options.backendBaseUrl ?? backendBaseUrl();
  const viewer = options.viewer ?? {};
  const timeoutMs = options.timeoutMs ?? 120_000; // 分割子进程可能较慢

  const contextLine = viewer.image_id
    ? ` The viewer currently shows image "${viewer.image_id}"${viewer.task ? ` with task "${viewer.task}"` : ""}.`
    : " No image is currently open in the viewer.";

  return {
    name: RUN_TASK_TOOL_NAME,
    label: "Run analysis task",
    description:
      "Run a Glaux image-analysis task (calibrated segmentation + measurement) on an image via the science-core backend and show the result in the viewer. " +
      "Use it when the user asks to measure, segment, analyse, or re-run analysis on the current image." +
      contextLine,
    parameters: RunTaskParams,
    async execute(_toolCallId, params, signal) {
      const imageId = params.image_id?.trim() || viewer.image_id;
      const task = params.task?.trim() || viewer.task;
      if (!imageId) {
        throw new Error(
          "No image is open in the viewer and no image_id was given. Ask the user to open an image first.",
        );
      }
      if (!task) {
        throw new Error(
          "No task is selected in the viewer and no task was given. Ask the user which analysis task to run.",
        );
      }
      const body: Record<string, unknown> = { task, image_id: imageId };
      const method = params.method?.trim() || viewer.method;
      if (method) body.method = method;
      if (viewer.cubs_cf !== undefined) body.cubs_cf = viewer.cubs_cf;
      if (viewer.roi_box) body.roi_box = viewer.roi_box;

      const abort = AbortSignal.timeout(timeoutMs);
      const combined = signal ? AbortSignal.any([signal, abort]) : abort;
      const response = await doFetch(`${base}/task/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: combined,
      });
      if (!response.ok) {
        let detail = `HTTP ${response.status}`;
        try {
          const j = (await response.json()) as { detail?: unknown };
          if (j?.detail) detail = String(j.detail);
        } catch {
          /* 非 JSON 错误体 */
        }
        throw new Error(`Backend rejected the task run: ${detail}`);
      }
      const output = (await response.json()) as TaskOutputLike;
      return {
        content: [{ type: "text", text: summarize(task, imageId, output) }],
        details: { kind: TASK_OUTPUT_DETAILS_KIND, task, image_id: imageId, output },
      };
    },
  };
}
