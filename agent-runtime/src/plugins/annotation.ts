/** 区域定位、通用分割与建议态标注（SDD 02）。 */
import type { HarnessTool } from "../pi/harness-registry.js";
import { createLocateRoiTool, LOCATE_ROI_TOOL_NAME } from "../pi/tools/locate-roi.js";
import { createProposeAnnotationTool, PROPOSE_ANNOTATION_TOOL_NAME } from "../pi/tools/propose-annotation.js";
import { createSegmentRegionTool, SEGMENT_REGION_TOOL_NAME } from "../pi/tools/segment-region.js";
import type { GlauxPlugin } from "./types.js";

const LOCATE_PROMPT =
  " To find where a described structure is, use locate_roi — it is your own vision plus atlas precedent, and it " +
  "understands domain findings a general segmenter does not. It returns rectangles, not exact outlines.";

const SEGMENT_PROMPT =
  " You can outline a structure with the segment_region tool; it returns candidate polygons, never finished " +
  "annotations — the user confirms them. It is a general-purpose segmenter that only knows everyday objects, so " +
  "prefer locate_roi for domain findings and run_task for calibrated measurements, and never fabricate " +
  "coordinates when nothing is found.";

const PROPOSE_PROMPT =
  " To put a region on the image, call propose_annotation — one region per call, only the ones you judge correct. " +
  "Every proposal waits for the user to confirm or reject it; you never confirm your own work, and you should say " +
  "plainly that the annotation is a suggestion.";

export const annotationPlugin: GlauxPlugin = {
  name: "annotation",
  applies: () => true,
  tools: [
    {
      name: LOCATE_ROI_TOOL_NAME, effect: "compute", projectScoped: true, requires: { vision: true, runtime: true }, supports: (focus) => !!focus,
      create: (ctx) => createLocateRoiTool({ runtime: ctx.runtime!, connection: ctx.connection!, ...(ctx.viewer ? { viewer: ctx.viewer } : {}) }) as HarnessTool,
      promptFragment: () => LOCATE_PROMPT,
    },
    {
      name: SEGMENT_REGION_TOOL_NAME, effect: "egress", projectScoped: true, requires: { egress: true }, supports: (focus) => !!focus,
      create: (ctx) => createSegmentRegionTool({ ...(ctx.viewer ? { viewer: ctx.viewer } : {}) }) as HarnessTool,
      promptFragment: () => SEGMENT_PROMPT,
    },
    {
      name: PROPOSE_ANNOTATION_TOOL_NAME, effect: "annotate", projectScoped: true, requires: {}, supports: (focus) => !!focus,
      create: (ctx) => createProposeAnnotationTool({ ...(ctx.viewer ? { viewer: ctx.viewer } : {}) }) as HarnessTool,
      promptFragment: () => PROPOSE_PROMPT,
    },
  ],
};
