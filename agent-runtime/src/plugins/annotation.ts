/** 区域定位、通用分割与建议态标注（SDD 02）。 */
import { langOf, localizeTool, type Bilingual } from "../i18n/prompt-lang.js";
import type { HarnessTool } from "../pi/harness-registry.js";
import { createListAnnotationsTool, LIST_ANNOTATIONS_TOOL_NAME, LIST_ANNOTATIONS_ZH } from "../pi/tools/list-annotations.js";
import { createLocateRoiTool, LOCATE_ROI_TOOL_NAME, LOCATE_ROI_ZH } from "../pi/tools/locate-roi.js";
import { createProposeAnnotationTool, PROPOSE_ANNOTATION_TOOL_NAME, PROPOSE_ANNOTATION_ZH } from "../pi/tools/propose-annotation.js";
import { createReviseAnnotationTool, REVISE_ANNOTATION_TOOL_NAME, REVISE_ANNOTATION_ZH } from "../pi/tools/revise-annotation.js";
import { createSegmentRegionTool, SEGMENT_REGION_TOOL_NAME, SEGMENT_REGION_ZH } from "../pi/tools/segment-region.js";
import { viewRegistryFor } from "../pi/tools/view-registry.js";
import type { GlauxPlugin } from "./types.js";

const LOCATE_PROMPT: Bilingual = {
  en: " To find where a described structure is, use locate_roi — it is your own vision plus atlas precedent, and it " +
    "understands domain findings a general segmenter does not. It returns rectangles, not exact outlines.",
  zh: "要找出所描述结构的位置，请用 locate_roi——它结合你自己的视觉与图谱先例，能理解通用分割器不懂的领域所见。" +
    "它返回矩形框，不是精确轮廓。",
};

const SEGMENT_PROMPT: Bilingual = {
  en: " You can outline a structure with the segment_region tool; it returns candidate polygons, never finished " +
    "annotations — the user confirms them. It is a general-purpose segmenter that only knows everyday objects, so " +
    "prefer locate_roi for domain findings and run_task for calibrated measurements, and never fabricate " +
    "coordinates when nothing is found.",
  zh: "你可以用 segment_region 勾画结构；它返回候选多边形，而不是完成的标注——由用户确认。" +
    "它是只认识日常物体的通用分割器，所以领域所见优先用 locate_roi，标定测量用 run_task；什么都没找到时绝不编造坐标。",
};

const PROPOSE_PROMPT: Bilingual = {
  en: " To put a region on the image, call propose_annotation — one region per call, only the ones you judge correct. " +
    "Every proposal waits for the user to confirm or reject it; you never confirm your own work, and you should say " +
    "plainly that the annotation is a suggestion.",
  zh: "要在图像上标出区域，请调用 propose_annotation——每次调用一个区域，只提交你判断正确的区域。" +
    "每条建议都等待用户确认或拒绝；你从不确认自己的结果，并应明确说明标注只是建议。",
};

/** SDD 22 §7.5：提出后放大复核，偏差就修订原建议。 */
const REVISE_PROMPT: Bilingual = {
  en: " After proposing a region, check it: call view_current_image with a region around it to see your outline drawn on " +
    "the enlarged picture, and compare it with the structure's edges. If it is off, fix that same suggestion with " +
    "revise_annotation (using the view_id of the zoomed view) instead of proposing another; withdraw it if it was wrong. " +
    "Zoom in again to confirm, and stop once the fit is good.",
  zh: "提出区域后要复核：用 view_current_image 传入框附近的 region，在放大的画面上看你画的轮廓，与结构边缘对照。" +
    "有偏差就用 revise_annotation 修正同一条建议（用放大视图的 view_id），不要再提一条；判断错了就撤回。" +
    "修正后再放大确认，贴合后即可停止。",
};

/** SDD 23 §7.5 规则 6：标签取自用户的目录。 */
const LIST_PROMPT: Bilingual = {
  en: " Labels come from the user's label catalog. If you do not know the catalog yet, call list_annotations before " +
    "proposing and use its label names exactly; list_annotations also answers how many annotations there are and how " +
    "large they are, with the same numbers the user sees in the annotation panel.",
  zh: "标签取自用户的标签目录。不清楚目录时，先调用 list_annotations，再按其中的名称原样提建议；" +
    "回答有几处标注、面积多大时也用 list_annotations，数字与用户在标注面板看到的一致。",
};

export const annotationPlugin: GlauxPlugin = {
  name: "annotation",
  applies: () => true,
  tools: [
    {
      name: LOCATE_ROI_TOOL_NAME, effect: "compute", projectScoped: true, requires: { vision: true, runtime: true }, supports: (focus) => !!focus,
      create: (ctx) => localizeTool(createLocateRoiTool({ runtime: ctx.runtime!, connection: ctx.connection!, ...(ctx.viewer ? { viewer: ctx.viewer } : {}) }), langOf(ctx), LOCATE_ROI_ZH) as HarnessTool,
      promptFragment: (ctx) => LOCATE_PROMPT[langOf(ctx)],
    },
    {
      name: SEGMENT_REGION_TOOL_NAME, effect: "egress", projectScoped: true, requires: { egress: true }, supports: (focus) => !!focus,
      create: (ctx) => localizeTool(createSegmentRegionTool({ ...(ctx.viewer ? { viewer: ctx.viewer } : {}) }), langOf(ctx), SEGMENT_REGION_ZH) as HarnessTool,
      promptFragment: (ctx) => SEGMENT_PROMPT[langOf(ctx)],
    },
    {
      name: PROPOSE_ANNOTATION_TOOL_NAME, effect: "annotate", projectScoped: true, requires: {}, supports: (focus) => !!focus,
      create: (ctx) => localizeTool(createProposeAnnotationTool({ ...(ctx.viewer ? { viewer: ctx.viewer } : {}), views: viewRegistryFor(ctx.run) }), langOf(ctx), PROPOSE_ANNOTATION_ZH) as HarnessTool,
      promptFragment: (ctx) => PROPOSE_PROMPT[langOf(ctx)],
    },
    {
      name: LIST_ANNOTATIONS_TOOL_NAME, effect: "read", projectScoped: true, requires: {}, supports: (focus) => !!focus,
      create: (ctx) => localizeTool(createListAnnotationsTool({ ...(ctx.viewer ? { viewer: ctx.viewer } : {}) }), langOf(ctx), LIST_ANNOTATIONS_ZH) as HarnessTool,
      promptFragment: (ctx) => LIST_PROMPT[langOf(ctx)],
    },
    {
      name: REVISE_ANNOTATION_TOOL_NAME, effect: "annotate", projectScoped: true, requires: {}, supports: (focus) => !!focus,
      create: (ctx) => localizeTool(createReviseAnnotationTool({ ...(ctx.viewer ? { viewer: ctx.viewer } : {}), views: viewRegistryFor(ctx.run) }), langOf(ctx), REVISE_ANNOTATION_ZH) as HarnessTool,
      promptFragment: (ctx) => REVISE_PROMPT[langOf(ctx)],
    },
  ],
};
