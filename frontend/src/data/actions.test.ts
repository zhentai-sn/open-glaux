import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../api/client";
import type { ImageMeta } from "../api/types";
import { TOOL_OPTIONS_DEFAULTS, useSession } from "../store/session";
import { selectNaturalImage } from "./actions";

const CAT: ImageMeta = {
  id: "natural_cat",
  center: "Natural images",
  cf: null,
  methods: [],
  modality: "natural_image",
};

describe("selectNaturalImage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    useSession.setState({
      modality: "ct_abdomen",
      naturalImages: [CAT],
      activeImage: null,
      activeVolume: "ct_001",
      activeSlide: "slide_001",
      wsiRoi: [1, 2, 30, 40],
      imageMeta: null,
      metrics: {
        volume: { value: 3, unit: "mL", label_en: "Volume", label_zh: "体积" },
      },
      primitives: [{ kind: "bbox", id: "old", role: "old", x0: 1, y0: 2, x1: 3, y1: 4 }],
      annotations: [],
      modelVersion: "totalsegmentator_v2",
      tool: "brush",
      toolOptions: {
        brush: { ...TOOL_OPTIONS_DEFAULTS.brush },
        voi: { ...TOOL_OPTIONS_DEFAULTS.voi },
      },
    });
  });

  it("opens the raster image and clears medical state without calling taskRun", () => {
    const run = vi.spyOn(api, "taskRun");
    selectNaturalImage("natural_cat");

    const s = useSession.getState();
    expect(s.modality).toBe("natural_image");
    expect(s.activeImage).toBe("natural_cat");
    expect(s.activeVolume).toBeNull();
    expect(s.activeSlide).toBeNull();
    expect(s.wsiRoi).toBeNull();
    expect(s.imageMeta).toEqual(CAT);
    expect(s.metrics).toBeNull();
    expect(s.primitives).toEqual([]);
    expect(s.modelVersion).toBe("");
    expect(s.tool).toBe("cursor");
    expect(run).not.toHaveBeenCalled();
  });

  it("ignores ids outside the loaded natural-image whitelist", () => {
    selectNaturalImage("natural_unknown");
    expect(useSession.getState().modality).toBe("ct_abdomen");
    expect(useSession.getState().activeVolume).toBe("ct_001");
  });
});
