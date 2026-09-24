/** SDD 10 D-15：分割后端的最小替换面；跟踪能力留待真实需求。 */
import type { SegmentInput, SegmentResult } from "./segmentation-client.js";

export interface SegmenterPort {
  segment(request: SegmentInput): Promise<SegmentResult[]>;
}
