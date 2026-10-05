/** SDD 11：Qwen 原生音画区间观察与证据提交。只在本次命令有 `VideoTurn` 时参与。 */
import { langOf, localizeTool, type Bilingual } from "../i18n/prompt-lang.js";
import type { HarnessTool } from "../pi/harness-registry.js";
import { createObserveVideoTool, createSubmitVideoAnswerTool, OBSERVE_VIDEO_ZH, SUBMIT_VIDEO_ANSWER_ZH } from "../pi/tools/video.js";
import type { GlauxPlugin } from "./types.js";

const VIDEO_PROMPT_EN =
  " You are not seeing the video by default. When the user asks about the frame currently shown in the viewer " +
  "(\"this frame\", \"the current picture\"), call view_current_image first: it returns exactly that frame and its source time. " +
  "Use observe_video_interval (synchronized picture and original sound, at most 60 s) for motion, sound or any span of time; " +
  "to cite the current frame, observe a short interval containing its source time. Never say you watched a range " +
  "unless an observation in this turn returned it. " +
  "Each observation's picture and sound reach you once, in the reply right after it, and are not resent; in that reply, " +
  "write down what you saw and heard with source times before your next tool call, and rely on those notes later. " +
  "A turn allows at most 12 observations: do not re-observe a range you already noted unless you need a closer look. " +
  "Verify events presupposed by the question, especially sounds, before citing them. Every factual conclusion about the video " +
  "must be submitted through submit_video_answer with source-video millisecond intervals and observation IDs; findings written " +
  "only in free text are shown to the user as unverified. Put unsupported parts in unanswered. Answer only the facts the user asked for: " +
  "do not add scene chronology or precise event onset claims unless the user requests them and the media supports them. " +
  "Do not infer sound from visible frames or invent a time beyond the video duration.";

const VIDEO_PROMPT: Bilingual = {
  en: VIDEO_PROMPT_EN,
  zh: "默认情况下你看不到视频。当用户问到查看器当前显示的画面（「这一帧」「当前画面」）时，先调用 view_current_image：" +
    "它恰好返回该帧及其源时间。涉及动作、声音或任何时间段时，用 observe_video_interval（同步的画面与原声，最长 60 秒）；" +
    "要引用当前帧，就观察包含其源时间的一小段区间。除非本回合的某次观察返回过某个区间，否则绝不说你看过它。" +
    "每次观察的画面与声音只在紧随其后的那次回复中送达一次，不会重发；请在那次回复里、下一次工具调用之前，" +
    "写下你看到和听到的内容及源时间，之后以这些记录为准。每回合最多 12 次观察：已记录的区间不要重复观察，除非需要细看。" +
    "引用问题所预设的事件（尤其是声音）之前，先核实它们。关于视频的每个事实结论都必须通过 submit_video_answer 提交，" +
    "附源视频毫秒区间与观察 ID；只写在自由文本里的结论会作为「未核实」展示给用户。没有证据支持的部分放进 unanswered。" +
    "只回答用户问到的事实：除非用户要求且媒体支持，不要补充场景时间线或精确的事件起始时间。" +
    "不要从可见画面推断声音，也不要编造超出视频时长的时间。",
};

export const videoPlugin: GlauxPlugin = {
  name: "video",
  applies: (ctx) => !!ctx.videoTurn,
  tools: [
    {
      name: "observe_video_interval", effect: "read", projectScoped: true, requires: { runtime: true }, supports: (focus) => focus?.kind === "video",
      create: (ctx) => localizeTool(createObserveVideoTool(ctx.videoTurn!), langOf(ctx), OBSERVE_VIDEO_ZH) as HarnessTool,
      promptFragment: (ctx) => VIDEO_PROMPT[langOf(ctx)],
    },
    {
      name: "submit_video_answer", effect: "read", projectScoped: true, requires: { runtime: true }, supports: (focus) => focus?.kind === "video",
      create: (ctx) => localizeTool(createSubmitVideoAnswerTool(ctx.videoTurn!), langOf(ctx), SUBMIT_VIDEO_ANSWER_ZH) as HarnessTool,
      promptFragment: () => "",
    },
  ],
};
