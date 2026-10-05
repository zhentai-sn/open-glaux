/** SDD 11 的两个受控动作：按需观察音画、提交带证据的回答。 */
import type { ToolZh } from "../../i18n/prompt-lang.js";
import { Type, type Static, type TextContent } from "@earendil-works/pi-ai";
import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";

import type { VideoAnswer } from "../../contracts.js";
import { RuntimeError } from "../../errors.js";
import { VIDEO_MARKER } from "../model-runtime.js";
import type { VideoTurn } from "../video-turn.js";

const ObserveParams = Type.Object({
  start_ms: Type.Integer({ minimum: 0, description: "原视频起点，毫秒，含端点" }),
  end_ms: Type.Integer({ minimum: 1, description: "原视频终点，毫秒，不含端点；最长 60000 ms" }),
  fps: Type.Optional(Type.Union([Type.Literal(0.5), Type.Literal(2), Type.Literal(5)], {
    description: "Qwen 观察抽帧密度；缺省 2",
  })),
});
const Interval = Type.Object({ start_ms: Type.Integer(), end_ms: Type.Integer() });
const Region = Type.Object({
  kind: Type.Literal("box"),
  x0: Type.Number(), y0: Type.Number(), x1: Type.Number(), y1: Type.Number(),
});
const Evidence = Type.Object({
  observation_id: Type.String(),
  kind: Type.Union([Type.Literal("visual"), Type.Literal("audio"), Type.Literal("av")]),
  source_interval: Interval,
  frame_time_ms: Type.Optional(Type.Integer()),
  region: Type.Optional(Region),
});
const AnswerParams = Type.Object({
  object_id: Type.String(),
  claims: Type.Array(Type.Object({ text: Type.String(), evidence: Type.Array(Evidence) })),
  unanswered: Type.Array(Type.String()),
});

function failure(error: unknown): string {
  return error instanceof RuntimeError ? `${error.code}: ${error.message}` : "视频操作失败，请缩短区间或重试";
}

export function createObserveVideoTool(turn: VideoTurn): AgentHarnessTool<undefined, typeof ObserveParams> {
  return {
    name: "observe_video_interval",
    label: "Observe a video interval with audio",
    description: "Observe the current video's synchronized picture and original sound. Choose a source interval in milliseconds (maximum 60 seconds). Inspect before making any visual or audio claim; revisit a range when necessary.",
    parameters: ObserveParams,
    async execute(_id, params: Static<typeof ObserveParams>, signal) {
      try {
        const observation = await turn.observe(params.start_ms, params.end_ms, params.fps ?? 2, signal);
        return {
          content: [{ type: "text", text: `${VIDEO_MARKER}${observation.observation_id}\nObserved source ${observation.actual_interval.start_ms}..${observation.actual_interval.end_ms} ms with ${observation.encoding.audio ? "original audio" : "no audio track"}. Cite this observation ID in submit_video_answer. The media is shown to you only in your next reply and is not resent: write down now what you see and hear, with source times, before calling any tool.` } satisfies TextContent],
          details: { kind: "glaux.video.observation", payload: observation },
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: failure(error) } satisfies TextContent],
          isError: true,
          details: { kind: "glaux.video.error" },
        };
      }
    },
  };
}

export function createSubmitVideoAnswerTool(turn: VideoTurn): AgentHarnessTool<undefined, typeof AnswerParams> {
  return {
    name: "submit_video_answer",
    label: "Submit a cited video answer",
    description: "Submit facts only with observation IDs and source-video time intervals that you actually observed. First verify events presupposed by the question. Use unanswered for any part lacking evidence. Local visual facts may include a source-frame box; audio evidence must not include a box.",
    parameters: AnswerParams,
    async execute(_id, params: Static<typeof AnswerParams>) {
      try {
        await turn.submit(params as VideoAnswer);
        return {
          content: [{ type: "text", text: "The cited video answer was accepted. Do not restate unverified claims." } satisfies TextContent],
          details: { kind: "glaux.video.answer", payload: params },
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: failure(error) } satisfies TextContent],
          isError: true,
          details: { kind: "glaux.video.error" },
        };
      }
    },
  };
}

/** 中文工具定义（SDD 20 §7.3）。参数说明原本就是中文，两种语言相同。 */
export const OBSERVE_VIDEO_ZH: ToolZh = {
  description: "观察当前视频的同步画面与原声。选择以毫秒计的源区间（最长 60 秒）。作出任何画面或声音方面的断言之前先观察；必要时重新观察某段区间。",
  parameters: {
    start_ms: "原视频起点，毫秒，含端点",
    end_ms: "原视频终点，毫秒，不含端点；最长 60000 ms",
    fps: "Qwen 观察抽帧密度；缺省 2",
  },
};

export const SUBMIT_VIDEO_ANSWER_ZH: ToolZh = {
  description: "只提交你实际观察到的事实，并附观察 ID 与源视频时间区间。先核实问题所预设的事件。缺少证据的部分放进 unanswered。局部画面事实可以附源帧框；音频证据不能附框。",
  parameters: {},
};
