/** SDD 11：Qwen 原生音画区间观察与证据提交。只在本次命令有 `VideoTurn` 时参与。 */
import type { HarnessTool } from "../pi/harness-registry.js";
import { createObserveVideoTool, createSubmitVideoAnswerTool } from "../pi/tools/video.js";
import type { GlauxPlugin } from "./types.js";

const VIDEO_PROMPT =
  " You are not seeing the video by default. When the user asks about the frame currently shown in the viewer " +
  "(\"this frame\", \"the current picture\"), call view_current_image first: it returns exactly that frame and its source time. " +
  "Use observe_video_interval (synchronized picture and original sound, at most 60 s) for motion, sound or any span of time; " +
  "to cite the current frame, observe a short interval containing its source time. Never say you watched a range " +
  "unless an observation in this turn returned it. " +
  "Verify events presupposed by the question, especially sounds, before citing them. Every factual conclusion about the video " +
  "must be submitted through submit_video_answer with source-video millisecond intervals and observation IDs; findings written " +
  "only in free text are shown to the user as unverified. Put unsupported parts in unanswered. Answer only the facts the user asked for: " +
  "do not add scene chronology or precise event onset claims unless the user requests them and the media supports them. " +
  "Do not infer sound from visible frames or invent a time beyond the video duration.";

export const videoPlugin: GlauxPlugin = {
  name: "video",
  applies: (ctx) => !!ctx.videoTurn,
  tools: [
    {
      name: "observe_video_interval", effect: "read", projectScoped: true, requires: { runtime: true }, supports: (focus) => focus?.kind === "video",
      create: (ctx) => createObserveVideoTool(ctx.videoTurn!) as HarnessTool,
      promptFragment: () => VIDEO_PROMPT,
    },
    {
      name: "submit_video_answer", effect: "read", projectScoped: true, requires: { runtime: true }, supports: (focus) => focus?.kind === "video",
      create: (ctx) => createSubmitVideoAnswerTool(ctx.videoTurn!) as HarnessTool,
      promptFragment: () => "",
    },
  ],
};
